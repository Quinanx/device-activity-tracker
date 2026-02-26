import jsPDF from 'jspdf';
import html2canvas from 'html2canvas';

export interface ActivityPDFData {
    contactNumber: string;
    platform: 'whatsapp' | 'signal';
    wakeUpTime: string | null;
    sleepStart: string | null;
    totalActiveMinutes: number;
    deviceChanges: number;
    frequencies: { hour: number; wakeUps: number }[];
    currentStatus: string;
    avgRtt: number;
    threshold: number;
}

/**
 * Generates a PDF report with the provided activity data
 */
export async function generateActivityPDF(
    data: ActivityPDFData,
    chartElement?: HTMLElement
): Promise<void> {
    try {
        const pdf = new jsPDF({
            orientation: 'portrait',
            unit: 'mm',
            format: 'a4'
        });

        const pageWidth = pdf.internal.pageSize.getWidth();
        const pageHeight = pdf.internal.pageSize.getHeight();
        let yPosition = 15;

        // Title
        pdf.setFontSize(20);
        pdf.text('Activity Analysis Report', pageWidth / 2, yPosition, { align: 'center' });
        yPosition += 12;

        pdf.setFontSize(10);
        pdf.setTextColor(100);
        pdf.text(`Generated: ${new Date().toLocaleString()}`, pageWidth / 2, yPosition, {
            align: 'center'
        });
        yPosition += 10;

        // Separator
        pdf.setDrawColor(200);
        pdf.line(10, yPosition, pageWidth - 10, yPosition);
        yPosition += 8;

        // Contact Information
        pdf.setFontSize(14);
        pdf.setTextColor(0);
        pdf.text('Contact Information', 10, yPosition);
        yPosition += 8;

        pdf.setFontSize(10);
        pdf.setTextColor(60);
        const contactInfo = [
            [`Contact Number:`, data.contactNumber],
            [`Platform:`, data.platform === 'whatsapp' ? 'WhatsApp' : 'Signal'],
            [`Status:`, data.currentStatus],
            [`Avg RTT:`, `${data.avgRtt.toFixed(0)} ms`],
            [`Threshold:`, `${data.threshold.toFixed(0)} ms`]
        ];

        for (const [label, value] of contactInfo) {
            pdf.text(label, 15, yPosition);
            pdf.text(String(value), 70, yPosition);
            yPosition += 6;
        }

        yPosition += 4;
        pdf.setDrawColor(200);
        pdf.line(10, yPosition, pageWidth - 10, yPosition);
        yPosition += 8;

        // Daily Patterns
        pdf.setFontSize(14);
        pdf.setTextColor(0);
        pdf.text('Daily Activity Patterns', 10, yPosition);
        yPosition += 8;

        pdf.setFontSize(10);
        pdf.setTextColor(60);
        const patterns = [
            [`Wake-up Time:`, data.wakeUpTime || 'Not detected'],
            [`Sleep Start:`, data.sleepStart || 'Not detected'],
            [`Total Active Minutes:`, `${data.totalActiveMinutes} minutes`],
            [`Device Changes:`, `${data.deviceChanges} transitions`]
        ];

        for (const [label, value] of patterns) {
            pdf.text(label, 15, yPosition);
            pdf.text(String(value), 70, yPosition);
            yPosition += 6;
        }

        yPosition += 4;
        pdf.setDrawColor(200);
        pdf.line(10, yPosition, pageWidth - 10, yPosition);
        yPosition += 8;

        // Hourly Frequency
        pdf.setFontSize(14);
        pdf.setTextColor(0);
        pdf.text('Hourly Activity Frequency', 10, yPosition);
        yPosition += 8;

        pdf.setFontSize(9);
        pdf.setTextColor(60);

        // Display only hours with activity
        const activeHours = data.frequencies.filter(f => f.wakeUps > 0);
        if (activeHours.length > 0) {
            let columnX = 15;
            let itemsInColumn = 0;
            let startY = yPosition;

            for (const freq of activeHours) {
                if (itemsInColumn >= 20) {
                    columnX += 50;
                    yPosition = startY;
                    itemsInColumn = 0;
                }

                const text = `${String(freq.hour).padStart(2, '0')}:00 - ${freq.wakeUps} wake-up(s)`;
                pdf.text(text, columnX, yPosition);
                yPosition += 5;
                itemsInColumn++;
            }
            yPosition = startY + 105;
        } else {
            pdf.text('No activity detected in this period', 15, yPosition);
            yPosition += 6;
        }

        yPosition += 4;
        pdf.setDrawColor(200);
        pdf.line(10, yPosition, pageWidth - 10, yPosition);
        yPosition += 8;

        // Chart Image (if provided)
        if (chartElement) {
            try {
                const canvas = await html2canvas(chartElement, {
                    backgroundColor: '#ffffff',
                    scale: 2,
                    logging: false
                });

                const imgData = canvas.toDataURL('image/png');
                const chartWidth = pageWidth - 20;
                const chartHeight = (canvas.height / canvas.width) * chartWidth;

                // Check if we need a new page
                if (yPosition + chartHeight > pageHeight - 10) {
                    pdf.addPage();
                    yPosition = 10;
                }

                pdf.addImage(imgData, 'PNG', 10, yPosition, chartWidth, chartHeight);
                yPosition += chartHeight + 5;
            } catch (err) {
                console.error('Error adding chart to PDF:', err);
            }
        }

        // Footer
        yPosition = pageHeight - 15;
        pdf.setFontSize(8);
        pdf.setTextColor(150);
        pdf.text(
            'This report is for research and privacy analysis purposes only.',
            pageWidth / 2,
            yPosition,
            { align: 'center' }
        );

        // Download PDF
        const filename = `${data.contactNumber}_activity_${new Date().toISOString().split('T')[0]}.pdf`;
        pdf.save(filename);
    } catch (error) {
        console.error('Error generating PDF:', error);
        throw error;
    }
}

/**
 * Export tracker data as JSON
 */
export function exportActivityJSON(data: ActivityPDFData): void {
    const jsonData = JSON.stringify(data, null, 2);
    const blob = new Blob([jsonData], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${data.contactNumber}_activity_${new Date().toISOString().split('T')[0]}.json`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
}

/**
 * Export tracker data as CSV
 */
export function exportActivityCSV(
    data: ActivityPDFData,
    rtts?: Array<{ timestamp: number; rtt: number; state: string }>
): void {
    const lines: string[] = [
        'Device Activity Tracker Export',
        `Contact Number,${data.contactNumber}`,
        `Platform,${data.platform}`,
        `Generated,${new Date().toISOString()}`,
        `Current Status,${data.currentStatus}`,
        `Avg RTT,${data.avgRtt.toFixed(0)} ms`,
        `Threshold,${data.threshold.toFixed(0)} ms`,
        '',
        'Daily Patterns',
        `Wake-up Time,${data.wakeUpTime || 'Not detected'}`,
        `Sleep Start,${data.sleepStart || 'Not detected'}`,
        `Total Active Minutes,${data.totalActiveMinutes}`,
        `Device Changes,${data.deviceChanges}`,
        ''
    ];

    if (rtts && rtts.length > 0) {
        lines.push('RTT History');
        lines.push('Timestamp,RTT (ms),State');
        for (const entry of rtts) {
            const timestamp = new Date(entry.timestamp).toISOString();
            lines.push(`${timestamp},${entry.rtt},${entry.state}`);
        }
        lines.push('');
    }

    if (data.frequencies.length > 0) {
        lines.push('Hourly Activity');
        lines.push('Hour,Wake-ups');
        for (const freq of data.frequencies) {
            if (freq.wakeUps > 0) {
                lines.push(`${String(freq.hour).padStart(2, '0')}:00,${freq.wakeUps}`);
            }
        }
    }

    const csv = lines.join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${data.contactNumber}_activity_${new Date().toISOString().split('T')[0]}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
}
