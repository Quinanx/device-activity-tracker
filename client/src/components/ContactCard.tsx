import React, { useState, useEffect } from 'react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { Square, Activity, Wifi, Smartphone, Monitor, MessageCircle, Download, Clock } from 'lucide-react';
import clsx from 'clsx';
import { generateActivityPDF, exportActivityJSON, exportActivityCSV } from '../utils/pdfExport';

// local analysis helpers
function analyzeWakeUpTimes(data: TrackerData[], threshold: number): string | null {
    if (data.length < 5) return null;
    let consecutiveHigh = 0;
    for (let i = 0; i < data.length; i++) {
        const entry = data[i];
        if (entry.rtt > threshold) {
            consecutiveHigh++;
        } else {
            if (consecutiveHigh >= 5) {
                return new Date(entry.timestamp).toLocaleTimeString();
            }
            consecutiveHigh = 0;
        }
    }
    return null;
}

function analyzeSleepTime(data: TrackerData[], threshold: number): string | null {
    if (data.length < 6) return null;
    let consecutiveHigh = 0;
    let startIdx = 0;
    for (let i = 0; i < data.length; i++) {
        if (data[i].rtt > threshold) {
            if (consecutiveHigh === 0) startIdx = i;
            consecutiveHigh++;
            if (consecutiveHigh >= 6) {
                return new Date(data[startIdx].timestamp).toLocaleTimeString();
            }
        } else {
            consecutiveHigh = 0;
        }
    }
    return null;
}

function calculateActiveMinutes(data: TrackerData[], threshold: number): number {
    return data.filter(d => d.rtt < threshold).length * 5;
}

function detectDeviceChanges(data: TrackerData[]): number {
    if (data.length < 2) return 0;
    let changes = 0;
    let prev = data[0].state;
    for (let i = 1; i < data.length; i++) {
        if (data[i].state !== prev) {
            changes++;
            prev = data[i].state;
        }
    }
    return changes;
}

function analyzeFrequencyByHour(data: TrackerData[], threshold: number) {
    const freq: { hour: number; wakeUps: number }[] = [];
    const hours: { [hour: number]: number } = {};
    for (let h = 0; h < 24; h++) hours[h] = 0;
    let prevState = 'offline';
    for (const entry of data) {
        const hour = new Date(entry.timestamp).getHours();
        const state = entry.rtt < threshold ? 'online' : 'offline';
        if (prevState === 'offline' && state === 'online') {
            hours[hour]++;
        }
        prevState = state;
    }
    for (let h = 0; h < 24; h++) freq.push({ hour: h, wakeUps: hours[h] });
    return freq;
}

type Platform = 'whatsapp' | 'signal';

interface TrackerData {
    rtt: number;
    avg: number;
    median: number;
    threshold: number;
    state: string;
    timestamp: number;
}

interface DeviceInfo {
    jid: string;
    state: string;
    rtt: number;
    avg: number;
}

interface ContactCardProps {
    jid: string;
    displayNumber: string;
    data: TrackerData[];
    devices: DeviceInfo[];
    deviceCount: number;
    presence: string | null;
    profilePic: string | null;
    onRemove: () => void;
    privacyMode?: boolean;
    platform?: Platform;
    nextProbeTime?: number | null;

}

export function ContactCard({
    jid,
    displayNumber,
    data,
    devices,
    deviceCount,
    presence,
    profilePic,
    onRemove,
    privacyMode = false,
    platform = 'whatsapp',
    nextProbeTime
}: ContactCardProps) {
    const [countdown, setCountdown] = useState<number | null>(null);
    const [isExporting, setIsExporting] = useState(false);
    const [exportMenu, setExportMenu] = useState(false);

    // Update countdown timer
    useEffect(() => {
        if (!nextProbeTime) return;

        const updateCountdown = () => {
            const remaining = Math.max(0, nextProbeTime - Date.now());
            setCountdown(remaining);

            if (remaining === 0) {
                setCountdown(null);
            }
        };

        updateCountdown();
        const interval = setInterval(updateCountdown, 1000);
        return () => clearInterval(interval);
    }, [nextProbeTime]);

    const formatCountdown = (ms: number): string => {
        const seconds = Math.floor((ms / 1000) % 60);
        const minutes = Math.floor((ms / 60000) % 60);
        const hours = Math.floor(ms / 3600000);

        if (hours > 0) {
            return `${hours}h ${minutes}m ${seconds}s`;
        } else if (minutes > 0) {
            return `${minutes}m ${seconds}s`;
        } else {
            return `${seconds}s`;
        }
    };

    const handleExportPDF = async () => {
        setIsExporting(true);
        try {
            const chartElement = document.getElementById(`chart-${jid}`);

            const threshold = lastData?.threshold || 0;
            const pdfData = {
                contactNumber: displayNumber,
                platform,
                wakeUpTime: analyzeWakeUpTimes(data, threshold),
                sleepStart: analyzeSleepTime(data, threshold),
                totalActiveMinutes: calculateActiveMinutes(data, threshold),
                deviceChanges: detectDeviceChanges(data),
                frequencies: analyzeFrequencyByHour(data, threshold),
                currentStatus: currentStatus,
                avgRtt: lastData?.avg || 0,
                threshold: threshold
            } as any;

            await generateActivityPDF(pdfData, chartElement || undefined);
        } catch (error) {
            console.error('Error exporting PDF:', error);
        } finally {
            setIsExporting(false);
            setExportMenu(false);
        }
    };

    const handleExportJSON = () => {
        try {
            const threshold = lastData?.threshold || 0;
            exportActivityJSON({
                contactNumber: displayNumber,
                platform,
                wakeUpTime: analyzeWakeUpTimes(data, threshold),
                sleepStart: analyzeSleepTime(data, threshold),
                totalActiveMinutes: calculateActiveMinutes(data, threshold),
                deviceChanges: detectDeviceChanges(data),
                frequencies: analyzeFrequencyByHour(data, threshold),
                currentStatus: currentStatus,
                avgRtt: lastData?.avg || 0,
                threshold: threshold
            });
        } catch (error) {
            console.error('Error exporting JSON:', error);
        }
        setExportMenu(false);
    };

    const handleExportCSV = () => {
        try {
            const threshold = lastData?.threshold || 0;
            exportActivityCSV(
                {
                    contactNumber: displayNumber,
                    platform,
                    wakeUpTime: analyzeWakeUpTimes(data, threshold),
                    sleepStart: analyzeSleepTime(data, threshold),
                    totalActiveMinutes: calculateActiveMinutes(data, threshold),
                    deviceChanges: detectDeviceChanges(data),
                    frequencies: analyzeFrequencyByHour(data, threshold),
                    currentStatus: currentStatus,
                    avgRtt: lastData?.avg || 0,
                    threshold: threshold
                },
                data.map(d => ({ timestamp: d.timestamp, rtt: d.rtt, state: d.state }))
            );
        } catch (error) {
            console.error('Error exporting CSV:', error);
        }
        setExportMenu(false);
    };
    const lastData = data[data.length - 1];
    const currentStatus = devices.length > 0
        ? (devices.find(d => d.state === 'OFFLINE')?.state ||
            devices.find(d => d.state.includes('Online'))?.state ||
            devices[0].state)
        : 'Unknown';

    // Blur phone number in privacy mode
    const blurredNumber = privacyMode ? displayNumber.replace(/\d/g, '•') : displayNumber;

    return (
        <div className="bg-gradient-to-br from-white to-gray-50 rounded-xl shadow-lg border border-gray-200 overflow-hidden">
            {/* Header with Buttons */}
            <div className="bg-white border-b border-gray-200 px-6 py-4 flex items-center justify-between">
                <div className="flex items-center gap-3">
                    <span className={clsx(
                        "px-2 py-1 rounded text-xs font-medium flex items-center gap-1",
                        platform === 'whatsapp' ? "bg-green-100 text-green-700" : "bg-blue-100 text-blue-700"
                    )}>
                        <MessageCircle size={12} />
                        {platform === 'whatsapp' ? 'WhatsApp' : 'Signal'}
                    </span>
                    <h3 className="text-lg font-semibold text-gray-900">{blurredNumber}</h3>
                </div>
                <div className="flex items-center gap-2">
                    {/* Export Dropdown */}
                    <div className="relative">
                        <button
                            onClick={() => setExportMenu(!exportMenu)}
                            disabled={isExporting}
                            className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 flex items-center gap-2 font-medium transition-colors text-sm"
                        >
                            <Download size={16} /> Export
                        </button>
                        {exportMenu && (
                            <div className="absolute right-0 mt-2 w-48 bg-white border border-gray-200 rounded-lg shadow-lg z-10">
                                <button
                                    onClick={handleExportPDF}
                                    className="w-full text-left px-4 py-2 hover:bg-gray-50 border-b border-gray-100 first:rounded-t-lg"
                                >
                                    📄 Export as PDF
                                </button>
                                <button
                                    onClick={handleExportJSON}
                                    className="w-full text-left px-4 py-2 hover:bg-gray-50 border-b border-gray-100"
                                >
                                    📋 Export as JSON
                                </button>
                                <button
                                    onClick={handleExportCSV}
                                    className="w-full text-left px-4 py-2 hover:bg-gray-50 rounded-b-lg last:rounded-b-lg"
                                >
                                    📊 Export as CSV
                                </button>
                            </div>
                        )}
                    </div>
                    <button
                        onClick={onRemove}
                        className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 flex items-center gap-2 font-medium transition-colors text-sm"
                    >
                        <Square size={16} /> Stop
                    </button>
                </div>
            </div>

            <div className="p-6">
                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                    {/* Status Card */}
                    <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-200 flex flex-col items-center text-center">
                        <div className="relative mb-4">
                            <div className="w-32 h-32 rounded-full overflow-hidden bg-gray-100 border-4 border-white shadow-md">
                                {profilePic ? (
                                    <img
                                        src={profilePic}
                                        alt="Profile"
                                        className={clsx(
                                            "w-full h-full object-cover transition-all duration-200",
                                            privacyMode && "blur-xl scale-110"
                                        )}
                                        style={privacyMode ? {
                                            filter: 'blur(16px) contrast(0.8)',
                                        } : {}}
                                    />
                                ) : (
                                    <div className="w-full h-full flex items-center justify-center text-gray-400">
                                        No Image
                                    </div>
                                )}
                            </div>
                            <div className={clsx(
                                "absolute bottom-2 right-2 w-6 h-6 rounded-full border-2 border-white",
                                currentStatus === 'OFFLINE' ? "bg-red-500" :
                                    currentStatus.includes('Online') ? "bg-green-500" : "bg-gray-400"
                            )} />
                        </div>

                        <h4 className="text-xl font-bold text-gray-900 mb-1">{blurredNumber}</h4>

                        <div className="flex items-center gap-2 mb-4">
                            <span className={clsx(
                                "px-3 py-1 rounded-full text-sm font-medium",
                                currentStatus === 'OFFLINE' ? "bg-red-100 text-red-700" :
                                    currentStatus.includes('Online') ? "bg-green-100 text-green-700" :
                                        currentStatus === 'Standby' ? "bg-yellow-100 text-yellow-700" : "bg-gray-100 text-gray-700"
                            )}>
                                {currentStatus}
                            </span>
                        </div>

                        <div className="w-full pt-4 border-t border-gray-100 space-y-2">
                            <div className="flex justify-between items-center text-sm text-gray-600">
                                <span className="flex items-center gap-1"><Wifi size={16} /> Official Status</span>
                                <span className="font-medium">{presence || 'Unknown'}</span>
                            </div>
                            <div className="flex justify-between items-center text-sm text-gray-600">
                                <span className="flex items-center gap-1"><Smartphone size={16} /> Devices</span>
                                <span className="font-medium">{deviceCount || 0}</span>
                            </div>
                            {countdown !== null && (
                                <div className="flex justify-between items-center text-sm bg-blue-50 p-2 rounded border border-blue-100">
                                    <span className="flex items-center gap-1 text-blue-700">
                                        <Clock size={16} /> Next Probe
                                    </span>
                                    <span className="font-mono font-semibold text-blue-600">
                                        {formatCountdown(countdown)}
                                    </span>
                                </div>
                            )}
                        </div>

                        {/* Device List */}
                        {devices.length > 0 && (
                            <div className="w-full pt-4 border-t border-gray-100 mt-4">
                                <h5 className="text-xs font-semibold text-gray-500 uppercase mb-2">Device States</h5>
                                <div className="space-y-1">
                                    {devices.map((device, idx) => (
                                        <div key={device.jid} className="flex items-center justify-between text-sm py-1">
                                            <div className="flex items-center gap-2">
                                                <Monitor size={14} className="text-gray-400" />
                                                <span className="text-gray-600">Device {idx + 1}</span>
                                            </div>
                                            <span className={clsx(
                                                "px-2 py-0.5 rounded text-xs font-medium",
                                                device.state === 'OFFLINE' ? "bg-red-100 text-red-700" :
                                                    device.state.includes('Online') ? "bg-green-100 text-green-700" :
                                                        device.state === 'Standby' ? "bg-yellow-100 text-yellow-700" : "bg-gray-100 text-gray-700"
                                            )}>
                                                {device.state}
                                            </span>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}
                    </div>

                    {/* Metrics & Chart */}
                    <div className="md:col-span-2 space-y-6">
                        {/* Metrics Grid */}
                        <div className="grid grid-cols-3 gap-4">
                            <div className="bg-white p-4 rounded-xl shadow-sm border border-gray-200">
                                <div className="text-sm text-gray-500 mb-1 flex items-center gap-1"><Activity size={16} /> Current Avg RTT</div>
                                <div className="text-2xl font-bold text-gray-900">{lastData?.avg.toFixed(0) || '-'} ms</div>
                            </div>
                            <div className="bg-white p-4 rounded-xl shadow-sm border border-gray-200">
                                <div className="text-sm text-gray-500 mb-1">Median (50)</div>
                                <div className="text-2xl font-bold text-gray-900">{lastData?.median.toFixed(0) || '-'} ms</div>
                            </div>
                            <div className="bg-white p-4 rounded-xl shadow-sm border border-gray-200">
                                <div className="text-sm text-gray-500 mb-1">Threshold</div>
                                <div className="text-2xl font-bold text-blue-600">{lastData?.threshold.toFixed(0) || '-'} ms</div>
                            </div>
                        </div>

                        {/* Chart */}
                        <div
                            id={`chart-${jid}`}
                            className="bg-white p-6 rounded-xl shadow-sm border border-gray-200 h-[300px]"
                        >
                            <h5 className="text-sm font-medium text-gray-500 mb-4">RTT History & Threshold</h5>
                            <ResponsiveContainer width="100%" height="100%">
                                <LineChart data={data}>
                                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f0f0f0" />
                                    <XAxis dataKey="timestamp" hide />
                                    <YAxis domain={['auto', 'auto']} />
                                    <Tooltip
                                        labelFormatter={(label: any) => {
                                            const timestamp = Number(label);
                                            return isNaN(timestamp) ? '' : new Date(timestamp).toLocaleTimeString();
                                        }}
                                        contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }}
                                    />
                                    <Line type="monotone" dataKey="avg" stroke="#3b82f6" strokeWidth={2} dot={false} name="Avg RTT" isAnimationActive={false} />
                                    <Line type="step" dataKey="threshold" stroke="#ef4444" strokeDasharray="5 5" dot={false} name="Threshold" isAnimationActive={false} />
                                </LineChart>
                            </ResponsiveContainer>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}
