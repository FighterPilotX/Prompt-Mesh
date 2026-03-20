"""
PromptMesh Local Agent — runs on Windows, exposes real PC stats to SysAI
Port: 7842  |  Start: python agent/promptmesh_agent.py
"""

from flask import Flask, jsonify
from flask_cors import CORS
import psutil
import platform
import subprocess
import json
import os
import sys
import datetime

app = Flask(__name__)
CORS(app, origins=["null", "file://", "http://localhost", "http://127.0.0.1"])

# ── helpers ──────────────────────────────────────────────────────────────────

def _run_ps(cmd):
    """Run a PowerShell command and return stripped stdout, or '' on failure."""
    try:
        result = subprocess.run(
            ["powershell", "-NoProfile", "-NonInteractive", "-Command", cmd],
            capture_output=True, text=True, timeout=10
        )
        return result.stdout.strip()
    except subprocess.TimeoutExpired:
        print(f"[agent] PowerShell timeout: {cmd[:80]}", file=sys.stderr)
        return ""
    except Exception as e:
        print(f"[agent] PowerShell error: {e}", file=sys.stderr)
        return ""

# ── routes ───────────────────────────────────────────────────────────────────

@app.route("/ping")
def ping():
    return jsonify({"status": "ok", "agent": "promptmesh-agent", "version": "1.0.0"})


@app.route("/system")
def system_info():
    """Full system snapshot."""
    uname = platform.uname()
    boot = datetime.datetime.fromtimestamp(psutil.boot_time())
    uptime_sec = (datetime.datetime.now() - boot).total_seconds()

    return jsonify({
        "os": uname.system,
        "os_version": uname.version,
        "hostname": uname.node,
        "architecture": uname.machine,
        "processor": uname.processor,
        "uptime_hours": round(uptime_sec / 3600, 1),
        "boot_time": boot.strftime("%Y-%m-%d %H:%M:%S"),
        "python_version": platform.python_version(),
    })


@app.route("/cpu")
def cpu_info():
    """CPU usage, frequency, and temperatures (if available)."""
    freq = psutil.cpu_freq()
    temps = {}
    try:
        sensors = psutil.sensors_temperatures()
        if sensors:
            temps = {k: [{"label": t.label, "current": t.current, "high": t.high}
                         for t in v] for k, v in sensors.items()}
    except AttributeError:
        # psutil.sensors_temperatures() not available on Windows
        # Try WMI as fallback
        try:
            import wmi
            w = wmi.WMI(namespace="root\\wmi")
            raw = w.MSAcpi_ThermalZoneTemperature()
            temps["thermal_zone"] = [
                {"label": f"Zone {i}", "current": round(t.CurrentTemperature / 10.0 - 273.15, 1)}
                for i, t in enumerate(raw)
            ]
        except Exception:
            temps = {}

    return jsonify({
        "physical_cores": psutil.cpu_count(logical=False),
        "logical_cores": psutil.cpu_count(logical=True),
        "usage_percent": psutil.cpu_percent(interval=0.5),
        "per_core_percent": psutil.cpu_percent(interval=0.5, percpu=True),
        "freq_current_mhz": round(freq.current, 0) if freq else None,
        "freq_max_mhz": round(freq.max, 0) if freq else None,
        "temperatures": temps,
    })


@app.route("/memory")
def memory_info():
    """RAM and swap usage."""
    vm = psutil.virtual_memory()
    sw = psutil.swap_memory()
    return jsonify({
        "total_gb": round(vm.total / 1e9, 2),
        "available_gb": round(vm.available / 1e9, 2),
        "used_gb": round(vm.used / 1e9, 2),
        "percent": vm.percent,
        "swap_total_gb": round(sw.total / 1e9, 2),
        "swap_used_gb": round(sw.used / 1e9, 2),
        "swap_percent": sw.percent,
    })


@app.route("/disk")
def disk_info():
    """Disk partitions, usage, and I/O stats."""
    partitions = []
    for p in psutil.disk_partitions(all=False):
        try:
            usage = psutil.disk_usage(p.mountpoint)
            partitions.append({
                "device": p.device,
                "mountpoint": p.mountpoint,
                "fstype": p.fstype,
                "total_gb": round(usage.total / 1e9, 2),
                "used_gb": round(usage.used / 1e9, 2),
                "free_gb": round(usage.free / 1e9, 2),
                "percent": usage.percent,
            })
        except PermissionError:
            continue

    io = psutil.disk_io_counters()
    return jsonify({
        "partitions": partitions,
        "io_read_gb": round(io.read_bytes / 1e9, 3) if io else None,
        "io_write_gb": round(io.write_bytes / 1e9, 3) if io else None,
    })


@app.route("/network")
def network_info():
    """Network interfaces and I/O."""
    addrs = psutil.net_if_addrs()
    stats = psutil.net_if_stats()
    io = psutil.net_io_counters()

    interfaces = []
    for name, addr_list in addrs.items():
        s = stats.get(name)
        interfaces.append({
            "name": name,
            "is_up": s.isup if s else False,
            "speed_mbps": s.speed if s else 0,
            "addresses": [{"family": str(a.family), "address": a.address} for a in addr_list],
        })

    return jsonify({
        "interfaces": interfaces,
        "bytes_sent_mb": round(io.bytes_sent / 1e6, 2),
        "bytes_recv_mb": round(io.bytes_recv / 1e6, 2),
        "packets_sent": io.packets_sent,
        "packets_recv": io.packets_recv,
        "errin": io.errin,
        "errout": io.errout,
    })


@app.route("/processes")
def top_processes():
    """Top 15 processes by CPU + memory usage."""
    procs = []
    for p in psutil.process_iter(["pid", "name", "cpu_percent", "memory_percent", "status"]):
        try:
            info = p.info
            info["memory_percent"] = round(info["memory_percent"] or 0, 2)
            info["cpu_percent"] = round(info["cpu_percent"] or 0, 2)
            procs.append(info)
        except (psutil.NoSuchProcess, psutil.AccessDenied):
            continue

    # Sort by cpu_percent desc, take top 15
    procs.sort(key=lambda x: x["cpu_percent"], reverse=True)
    return jsonify({"processes": procs[:15]})


@app.route("/startup")
def startup_programs():
    """List startup programs via PowerShell."""
    ps_cmd = (
        "Get-CimInstance Win32_StartupCommand | "
        "Select-Object Name, Command, Location, User | "
        "ConvertTo-Json -Compress"
    )
    raw = _run_ps(ps_cmd)
    try:
        items = json.loads(raw)
        if isinstance(items, dict):
            items = [items]  # single item comes back as object not array
    except Exception:
        items = []
    return jsonify({"startup_programs": items})


@app.route("/drivers")
def driver_info():
    """List signed/unsigned drivers via PowerShell."""
    ps_cmd = (
        "Get-WindowsDriver -Online -All | "
        "Select-Object ProviderName, Driver, Version, Date | "
        "Sort-Object Date -Descending | "
        "Select-Object -First 30 | "
        "ConvertTo-Json -Compress"
    )
    raw = _run_ps(ps_cmd)
    try:
        items = json.loads(raw)
        if isinstance(items, dict):
            items = [items]
    except Exception:
        items = []
    return jsonify({"drivers": items})


@app.route("/eventlog")
def event_log():
    """Last 20 critical/error Windows event log entries."""
    ps_cmd = (
        "Get-EventLog -LogName System -EntryType Error,Warning -Newest 20 | "
        "Select-Object TimeGenerated, EntryType, Source, Message | "
        "ConvertTo-Json -Compress"
    )
    raw = _run_ps(ps_cmd)
    try:
        items = json.loads(raw)
        if isinstance(items, dict):
            items = [items]
    except Exception:
        items = []

    # Truncate long messages to keep payload manageable
    for item in items:
        if item.get("Message") and len(item["Message"]) > 200:
            item["Message"] = item["Message"][:200] + "..."

    return jsonify({"events": items})


@app.route("/battery")
def battery_info():
    """Battery status (laptops only)."""
    bat = psutil.sensors_battery()
    if bat is None:
        return jsonify({"present": False})
    return jsonify({
        "present": True,
        "percent": bat.percent,
        "power_plugged": bat.power_plugged,
        "seconds_left": bat.secsleft if bat.secsleft != psutil.POWER_TIME_UNLIMITED else -1,
    })


@app.route("/gpu")
def gpu_info():
    """GPU info via PowerShell WMI (no extra libs required)."""
    ps_cmd = (
        "Get-CimInstance Win32_VideoController | "
        "Select-Object Name, DriverVersion, VideoModeDescription, AdapterRAM | "
        "ConvertTo-Json -Compress"
    )
    raw = _run_ps(ps_cmd)
    try:
        items = json.loads(raw)
        if isinstance(items, dict):
            items = [items]
        # Convert AdapterRAM bytes to GB
        for item in items:
            ram = item.get("AdapterRAM")
            if ram:
                item["AdapterRAM_GB"] = round(ram / 1e9, 2)
    except Exception:
        items = []
    return jsonify({"gpus": items})


@app.route("/snapshot")
def full_snapshot():
    """Single call — everything SysAI needs for a Quick Scan."""
    def safe(fn):
        try:
            return fn().get_json()
        except Exception as e:
            return {"error": str(e)}

    return jsonify({
        "system":    safe(system_info),
        "cpu":       safe(cpu_info),
        "memory":    safe(memory_info),
        "disk":      safe(disk_info),
        "network":   safe(network_info),
        "battery":   safe(battery_info),
        "gpu":       safe(gpu_info),
        "timestamp": datetime.datetime.now().isoformat(),
    })


# ── main ─────────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    print("=" * 55)
    print("  PromptMesh Local Agent  —  http://localhost:7842")
    print("  Endpoints: /ping /snapshot /cpu /memory /disk")
    print("             /network /processes /startup /drivers")
    print("             /eventlog /battery /gpu")
    print("=" * 55)
    app.run(host="127.0.0.1", port=7842, debug=False)
