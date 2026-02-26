/**
 * PDF Activity Report Generator
 * Generates comprehensive reports of tracked user activity patterns
 */

export interface ActivityEntry {
    timestamp: number;
    rtt: number;
    state: string;
}

export interface RelationshipData {
    contact1: string;
    contact2: string;
    overlapScore: number;
    simultaneousActivations: number;
}

export interface ActivityReport {
    contactNumber: string;
    platform: string;
    reportDate: string;
    wakeUpTime: string | null;
    sleepStart: string | null;
    totalActiveMinutes: number;
    deviceChanges: number;
    frequencyAnalysis: { hour: number; wakeUps: number }[];
    relationships?: RelationshipData[];
}

/**
 * Analyzes activity data to detect wake-up times
 * Wake-up = first low RTT (< threshold) after extended high RTT period
 */
export function analyzeWakeUpTimes(
    data: ActivityEntry[],
    threshold: number
): string | null {
    if (data.length < 10) return null;

    let foundLowRttAfterHighRtt = false;
    let consecutiveHighRttCount = 0;

    for (let i = 0; i < data.length; i++) {
        const entry = data[i];

        if (entry.rtt > threshold) {
            consecutiveHighRttCount++;
        } else {
            // Low RTT detected
            if (consecutiveHighRttCount >= 5) {
                // At least 5 consecutive high RTT readings before this low RTT
                foundLowRttAfterHighRtt = true;
                const wakeUpDate = new Date(entry.timestamp);
                return wakeUpDate.toLocaleTimeString('en-US', {
                    hour: '2-digit',
                    minute: '2-digit',
                    second: '2-digit'
                });
            }
            consecutiveHighRttCount = 0;
        }
    }

    return null;
}

/**
 * Analyzes when the device entered sleep/offline state
 * Sleep start = first sustained high RTT period lasting 30+ minutes
 */
export function analyzeSleepTime(
    data: ActivityEntry[],
    threshold: number
): string | null {
    if (data.length < 10) return null;

    let highRttStartIndex = -1;
    let consecutiveHighRtt = 0;

    for (let i = 0; i < data.length; i++) {
        const entry = data[i];

        if (entry.rtt > threshold) {
            if (consecutiveHighRtt === 0) {
                highRttStartIndex = i;
            }
            consecutiveHighRtt++;

            // If we have 6+ consecutive high RTT (each ~5min = 30+ min sleep)
            if (consecutiveHighRtt >= 6 && highRttStartIndex >= 0) {
                const sleepDate = new Date(data[highRttStartIndex].timestamp);
                return sleepDate.toLocaleTimeString('en-US', {
                    hour: '2-digit',
                    minute: '2-digit',
                    second: '2-digit'
                });
            }
        } else {
            consecutiveHighRtt = 0;
        }
    }

    return null;
}

/**
 * Calculates total active minutes (low RTT time)
 */
export function calculateActiveMinutes(
    data: ActivityEntry[],
    threshold: number
): number {
    if (data.length === 0) return 0;

    const lowRttEntries = data.filter(e => e.rtt < threshold);
    // Assume each entry represents 5 minutes (300000ms)
    return lowRttEntries.length * 5;
}

/**
 * Analyzes device activity by hour
 * Counts how many "wake up" events occur per hour
 */
export function analyzeFrequencyByHour(
    data: ActivityEntry[],
    threshold: number
): { hour: number; wakeUps: number }[] {
    const hourlyWakeUps: { [hour: number]: number } = {};

    for (let hour = 0; hour < 24; hour++) {
        hourlyWakeUps[hour] = 0;
    }

    let previousState = 'offline';

    for (const entry of data) {
        const hour = new Date(entry.timestamp).getHours();
        const currentState = entry.rtt < threshold ? 'online' : 'offline';

        // Count transition from offline -> online as a wake-up event
        if (previousState === 'offline' && currentState === 'online') {
            hourlyWakeUps[hour]++;
        }

        previousState = currentState;
    }

    return Object.keys(hourlyWakeUps).map(hour => ({
        hour: parseInt(hour),
        wakeUps: hourlyWakeUps[parseInt(hour)]
    }));
}

/**
 * Detects device changes (multi-device tracking)
 * Counts transitions between different device states
 */
export function detectDeviceChanges(data: ActivityEntry[]): number {
    if (data.length < 2) return 0;

    let changes = 0;
    let previousState = data[0].state;

    for (let i = 1; i < data.length; i++) {
        if (data[i].state !== previousState) {
            changes++;
            previousState = data[i].state;
        }
    }

    return changes;
}

/**
 * Analyzes activity overlap between two contacts
 * Returns a score 0-100 indicating likelihood they're communicating
 */
export function analyzeActivityOverlap(
    contact1Data: ActivityEntry[],
    contact2Data: ActivityEntry[],
    threshold: number
): RelationshipData {
    const simultaneousActivations = calculateSimultaneousActivations(
        contact1Data,
        contact2Data,
        threshold
    );

    // Score based on simultaneous online periods (higher = more likely communicating)
    const maxPossible = Math.min(contact1Data.length, contact2Data.length);
    const overlapScore = maxPossible > 0
        ? Math.round((simultaneousActivations / maxPossible) * 100)
        : 0;

    // Contact identifiers (would be full numbers in actual implementation)
    const contact1 = contact1Data.length > 0
        ? new Date(contact1Data[0].timestamp).toLocaleString()
        : 'Unknown';
    const contact2 = contact2Data.length > 0
        ? new Date(contact2Data[0].timestamp).toLocaleString()
        : 'Unknown';

    return {
        contact1,
        contact2,
        overlapScore,
        simultaneousActivations
    };
}

/**
 * Calculates simultaneous online periods
 */
function calculateSimultaneousActivations(
    data1: ActivityEntry[],
    data2: ActivityEntry[],
    threshold: number
): number {
    if (data1.length === 0 || data2.length === 0) return 0;

    const online1 = new Set(
        data1.filter(e => e.rtt < threshold).map(e => Math.floor(e.timestamp / 300000)) // 5min buckets
    );

    const online2 = new Set(
        data2.filter(e => e.rtt < threshold).map(e => Math.floor(e.timestamp / 300000))
    );

    let simultaneous = 0;
    for (const bucket of online1) {
        if (online2.has(bucket)) {
            simultaneous++;
        }
    }

    return simultaneous;
}

/**
 * Generates a text-based activity report
 */
export function generateTextReport(report: ActivityReport): string {
    const lines: string[] = [
        '═'.repeat(70),
        '                   ACTIVITY ANALYSIS REPORT',
        '═'.repeat(70),
        '',
        `Contact: ${report.contactNumber}`,
        `Platform: ${report.platform.toUpperCase()}`,
        `Report Date: ${report.reportDate}`,
        '',
        '─ DAILY PATTERNS ─'.padEnd(70, '─'),
        `Wake-up Time:           ${report.wakeUpTime || 'Not detected'}`,
        `Sleep Start:            ${report.sleepStart || 'Not detected'}`,
        `Total Active Minutes:   ${report.totalActiveMinutes} min`,
        `Device Changes:         ${report.deviceChanges}`,
        '',
        '─ HOURLY FREQUENCY ANALYSIS ─'.padEnd(70, '─'),
        ...report.frequencyAnalysis
            .filter(h => h.wakeUps > 0)
            .map(h => `Hour ${String(h.hour).padStart(2, '0')}:00 - ${h.wakeUps} wake-up(s)`),
        ''
    ];

    if (report.relationships && report.relationships.length > 0) {
        lines.push('─ RELATIONSHIP MAPPING ─'.padEnd(70, '─'));
        for (const rel of report.relationships) {
            lines.push(`Activity Overlap with ${rel.contact1}: ${rel.overlapScore}%`);
            lines.push(`  Simultaneous Online: ${rel.simultaneousActivations} periods`);
        }
        lines.push('');
    }

    lines.push('═'.repeat(70));
    lines.push('This report is generated for research and privacy analysis purposes.');
    lines.push('═'.repeat(70));

    return lines.join('\n');
}

/**
 * Generates JSON report data for PDF/external tools
 */
export function generateJsonReport(report: ActivityReport): string {
    return JSON.stringify(report, null, 2);
}

/**
 * Batch report for multiple contacts with relationship mapping
 */
export interface BatchActivityReport {
    reportDate: string;
    contacts: ActivityReport[];
    relationshipMap: RelationshipData[];
    summary: {
        totalContacts: number;
        avgActivityOverlap: number;
        suspectedGroups: string[][];
    };
}

/**
 * Generates batch report identifying groups of contacts with high overlap
 */
export function generateBatchReport(reports: ActivityReport[]): BatchActivityReport {
    // Calculate relationship map
    const relationshipMap: RelationshipData[] = [];
    const relations: { [key: string]: number } = {};

    if (reports.length > 1) {
        for (let i = 0; i < reports.length; i++) {
            for (let j = i + 1; j < reports.length; j++) {
                if (reports[i].frequencyAnalysis && reports[j].frequencyAnalysis) {
                    const key = `${reports[i].contactNumber}-${reports[j].contactNumber}`;
                    // Calculate overlap score based on activity at same hours
                    let overlapHours = 0;
                    for (const hour1 of reports[i].frequencyAnalysis) {
                        const hour2 = reports[j].frequencyAnalysis.find(
                            h => h.hour === hour1.hour && h.wakeUps > 0
                        );
                        if (hour2 && hour2.wakeUps > 0) {
                            overlapHours++;
                        }
                    }
                    relations[key] = overlapHours * 10; // Scale up for visibility
                }
            }
        }
    }

    // Identify suspected contact groups (contacts with high overlap)
    const suspectedGroups: string[][] = [];
    const processedPairs = new Set<string>();

    for (const [pair, score] of Object.entries(relations)) {
        if (score >= 50 && !processedPairs.has(pair)) {
            const [contact1, contact2] = pair.split('-');
            suspectedGroups.push([contact1, contact2]);
            processedPairs.add(pair);
        }
    }

    return {
        reportDate: new Date().toISOString().split('T')[0],
        contacts: reports,
        relationshipMap: relationshipMap.slice(0, 10), // Top 10 relationships
        summary: {
            totalContacts: reports.length,
            avgActivityOverlap: relationshipMap.length > 0
                ? relationshipMap.reduce((sum, r) => sum + r.overlapScore, 0) / relationshipMap.length
                : 0,
            suspectedGroups
        }
    };
}
