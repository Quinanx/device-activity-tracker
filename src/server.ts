/**
 * Device Activity Tracker - Web Server
 *
 * HTTP server with Socket.IO for real-time tracking visualization.
 * Provides REST API and WebSocket interface for the React frontend.
 *
 * For educational and research purposes only.
 */

import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import makeWASocket, { DisconnectReason, useMultiFileAuthState } from '@whiskeysockets/baileys';
import { pino } from 'pino';
import { Boom } from '@hapi/boom';
import { WhatsAppTracker, ProbeMethod } from './tracker.js';
import { SignalTracker, getSignalAccounts, checkSignalNumber } from './signal-tracker.js';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

// __dirname replacement for ES module
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Configuration
const SIGNAL_API_URL = process.env.SIGNAL_API_URL || 'http://localhost:8080';

const app = express();
app.use(cors());

// if a React build has been created, serve it
const clientBuildPath = path.join(__dirname, '../client/build');
console.log('[SERVER] Looking for client build at:', clientBuildPath);
console.log('[SERVER] __dirname is:', __dirname);
console.log('[SERVER] Client build exists:', fs.existsSync(clientBuildPath));

if (fs.existsSync(clientBuildPath)) {
    console.log('[SERVER] ✅ Serving static client from', clientBuildPath);
    app.use(express.static(clientBuildPath));
    // fallback to index.html for any non-API route
    app.use((req, res) => {
        res.sendFile(path.join(clientBuildPath, 'index.html'));
    });
} else {
    console.log('[SERVER] ⚠️  Client build NOT found at', clientBuildPath);
    // basic route so navigating to server port shows something
    app.get('/', (req, res) => {
        res.send('Device Activity Tracker API running');
    });

    // catch-all for unknown API routes
    app.use((req, res) => {
        res.status(404).send('404 Not Found');
    });
}

const httpServer = createServer(app);
const io = new Server(httpServer, {
    cors: {
        origin: "*", // Allow all origins for dev
        methods: ["GET", "POST"]
    }
});

let sock: any;
let isWhatsAppConnected = false;
let isSignalConnected = false;
let signalAccountNumber: string | null = null;
let globalProbeMethod: ProbeMethod = 'delete'; // Default to delete method
let globalProbeInterval = 20000; // default 20 seconds in ms
let currentWhatsAppQr: string | null = null; // Store current QR code for new clients

// Platform type for contacts
type Platform = 'whatsapp' | 'signal';

interface TrackerEntry {
    tracker: WhatsAppTracker | SignalTracker;
    platform: Platform;
}

const trackers: Map<string, TrackerEntry> = new Map(); // JID/Number -> Tracker entry

// Log history of activity for exports/automation
interface ActivityPoint {
    timestamp: number;
    rtt: number;
    avg?: number;
    state?: string;
    threshold?: number;
}
const activityLogs: Map<string, ActivityPoint[]> = new Map();

async function connectToWhatsApp() {
    try {
    const { state, saveCreds } = await useMultiFileAuthState('auth_info_baileys');

    sock = makeWASocket({
        version: [2, 3000, 1034074495], // Add this line
        auth: state,
        logger: pino({ level: 'debug' }),
        markOnlineOnConnect: true,
        printQRInTerminal: false,
    });

    sock.ev.on('connection.update', async (update: any) => {
        const { connection, lastDisconnect, qr } = update;

        if (qr) {
            console.log('QR Code generated');
            currentWhatsAppQr = qr; // Store the QR code
            io.emit('qr', qr);
        }

        if (connection === 'close') {
            isWhatsAppConnected = false;
            currentWhatsAppQr = null; // Clear QR on close
            const shouldReconnect = (lastDisconnect?.error as Boom)?.output?.statusCode !== DisconnectReason.loggedOut;
            console.log('connection closed, reconnecting ', shouldReconnect);
            if (shouldReconnect) {
                connectToWhatsApp();
            }
        } else if (connection === 'open') {
            isWhatsAppConnected = true;
            currentWhatsAppQr = null; // Clear QR on successful connection
            console.log('opened connection');
            io.emit('connection-open');
        }
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('messaging-history.set', ({ chats, contacts, messages, isLatest }: any) => {
        console.log(`[SESSION] History sync - Chats: ${chats.length}, Contacts: ${contacts.length}, Messages: ${messages.length}, Latest: ${isLatest}`);
    });

    sock.ev.on('messages.update', (updates: any) => {
        for (const update of updates) {
            console.log(`[MSG UPDATE] JID: ${update.key.remoteJid}, ID: ${update.key.id}, Status: ${update.update.status}, FromMe: ${update.key.fromMe}`);
        }
    });
    } catch (err) {
        console.error('[WA] Error during WhatsApp connection initialization:', err);
        // rethrow so callers can handle it if necessary
        throw err;
    }
}

// Connect to WhatsApp and surface any initialization errors
connectToWhatsApp().catch(err => {
    console.error('[WA] Failed to connect to WhatsApp:', err);
});

// global process handlers to avoid silent failures
process.on('unhandledRejection', reason => {
    console.error('[PROCESS] Unhandled Rejection:', reason);
});
process.on('uncaughtException', err => {
    console.error('[PROCESS] Uncaught Exception:', err);
});

// Signal linking state
let signalLinkingInProgress = false;
let signalApiAvailable = false;
let currentSignalQrUrl: string | null = null;

// Check Signal API availability
async function checkSignalApiAvailable(): Promise<boolean> {
    try {
        const response = await fetch(`${SIGNAL_API_URL}/v1/about`, {
            signal: AbortSignal.timeout(2000)
        });
        return response.ok;
    } catch {
        return false;
    }
}

// Check Signal connection status
async function checkSignalConnection() {
    try {
        const available = await checkSignalApiAvailable();
        if (available !== signalApiAvailable) {
            signalApiAvailable = available;
            console.log(`[SIGNAL] API available: ${available}`);
            io.emit('signal-api-status', { available });
        }

        if (!available) {
            if (isSignalConnected) {
                isSignalConnected = false;
                signalAccountNumber = null;
                io.emit('signal-disconnected');
            }
            return;
        }

        const accounts = await getSignalAccounts(SIGNAL_API_URL);
        if (accounts.length > 0) {
            if (!isSignalConnected) {
                isSignalConnected = true;
                signalAccountNumber = accounts[0];
                signalLinkingInProgress = false;
                console.log(`[SIGNAL] Connected with account: ${signalAccountNumber}`);
                io.emit('signal-connection-open', { number: signalAccountNumber });
            }
        } else {
            if (isSignalConnected) {
                isSignalConnected = false;
                signalAccountNumber = null;
                console.log('[SIGNAL] Disconnected');
                io.emit('signal-disconnected');
            }
            // No accounts - need to link, start QR code process
            if (!signalLinkingInProgress) {
                startSignalLinking();
            }
        }
    } catch (err) {
        console.log('[SIGNAL] Error checking connection:', err);
        if (isSignalConnected) {
            isSignalConnected = false;
            signalAccountNumber = null;
            io.emit('signal-disconnected');
        }
    }
}

// Start Signal device linking - signal-cli-rest-api returns QR as PNG image
async function startSignalLinking() {
    if (signalLinkingInProgress || isSignalConnected) return;

    signalLinkingInProgress = true;
    console.log('[SIGNAL] Starting device linking...');

    try {
        // Check if the QR endpoint is available
        const response = await fetch(`${SIGNAL_API_URL}/v1/qrcodelink?device_name=activity-tracker`);
        if (!response.ok) {
            console.log('[SIGNAL] Failed to start linking:', response.status);
            signalLinkingInProgress = false;
            return;
        }

        // signal-cli-rest-api returns the QR code as a PNG image directly
        // Send the URL to the frontend to display as an image
        currentSignalQrUrl = `${SIGNAL_API_URL}/v1/qrcodelink?device_name=activity-tracker&t=${Date.now()}`;
        console.log('[SIGNAL] Emitting QR image URL:', currentSignalQrUrl);
        io.emit('signal-qr-image', currentSignalQrUrl);

        // Keep polling to check if linking completed
        pollSignalLinkingStatus();
    } catch (err) {
        console.log('[SIGNAL] Error starting linking:', err);
        signalLinkingInProgress = false;
    }
}

// Poll to check if Signal linking has completed
async function pollSignalLinkingStatus() {
    const checkInterval = setInterval(async () => {
        try {
            const accounts = await getSignalAccounts(SIGNAL_API_URL);
            if (accounts.length > 0) {
                // Linking completed!
                clearInterval(checkInterval);
                signalLinkingInProgress = false;
                currentSignalQrUrl = null;
                isSignalConnected = true;
                signalAccountNumber = accounts[0];
                console.log(`[SIGNAL] Linking completed! Account: ${signalAccountNumber}`);
                io.emit('signal-connection-open', { number: signalAccountNumber });
            }
        } catch (err) {
            // Keep polling
        }
    }, 2000);

    // Stop polling after 5 minutes
    setTimeout(() => {
        clearInterval(checkInterval);
        signalLinkingInProgress = false;
    }, 300000);
}

// Check Signal connection periodically
checkSignalConnection();
setInterval(checkSignalConnection, 5000);

io.on('connection', (socket) => {
    console.log('Client connected');

    // Send current WhatsApp QR code if available
    if (currentWhatsAppQr) {
        socket.emit('qr', currentWhatsAppQr);
    }

    if (isWhatsAppConnected) {
        socket.emit('connection-open');
    }

    if (isSignalConnected && signalAccountNumber) {
        socket.emit('signal-connection-open', { number: signalAccountNumber });
    }

    // Send Signal API availability status
    socket.emit('signal-api-status', { available: signalApiAvailable });

    // Send current Signal QR code if linking is in progress
    if (signalLinkingInProgress && currentSignalQrUrl) {
        socket.emit('signal-qr-image', currentSignalQrUrl);
    }

    // Send current probe method and interval to client
    socket.emit('probe-method', globalProbeMethod);
    socket.emit('probe-interval', globalProbeInterval);

    // Send tracked contacts with platform info
    const trackedContacts = Array.from(trackers.entries()).map(([id, entry]) => ({
        id,
        platform: entry.platform
    }));

    // Handle request to get tracked contacts (for page refresh)
    socket.on('get-tracked-contacts', () => {
        const trackedContacts = Array.from(trackers.entries()).map(([id, entry]) => ({
            id,
            platform: entry.platform
        }));
        socket.emit('tracked-contacts', trackedContacts);
    });

    // Add contact - supports both WhatsApp and Signal
    socket.on('add-contact', async (data: string | { number: string; platform: Platform }) => {
        // Support both old format (string) and new format (object)
        const { number, platform } = typeof data === 'string'
            ? { number: data, platform: 'whatsapp' as Platform }
            : data;

        console.log(`Request to track on ${platform}: ${number}`);
        const cleanNumber = number.replace(/\D/g, '');

        if (platform === 'signal') {
            // Signal tracking
            if (!isSignalConnected || !signalAccountNumber) {
                socket.emit('error', { message: 'Signal is not connected. Please link Signal first.' });
                return;
            }

            const signalId = `signal:${cleanNumber}`;
            if (trackers.has(signalId)) {
                socket.emit('error', { jid: signalId, message: 'Already tracking this contact on Signal' });
                return;
            }

            try {
                const targetNumber = cleanNumber.startsWith('+') ? cleanNumber : `+${cleanNumber}`;

                // Check if number is registered and discoverable on Signal
                console.log(`[SIGNAL] Checking if ${targetNumber} is registered...`);
                const checkResult = await checkSignalNumber(SIGNAL_API_URL, signalAccountNumber, targetNumber);

                if (!checkResult.registered) {
                    console.log(`[SIGNAL] Number ${targetNumber} is not discoverable: ${checkResult.error}`);
                    socket.emit('error', {
                        jid: signalId,
                        message: checkResult.error || 'Number is not registered on Signal'
                    });
                    return;
                }

                console.log(`[SIGNAL] Number ${targetNumber} is registered, starting tracking...`);
                const tracker = new SignalTracker(SIGNAL_API_URL, signalAccountNumber, targetNumber);
                tracker.setProbeInterval(globalProbeInterval);

                trackers.set(signalId, { tracker, platform: 'signal' });

                tracker.onUpdate = (updateData) => {
                    io.emit('tracker-update', {
                        jid: signalId,
                        platform: 'signal',
                        nextProbeTime: tracker.getNextProbeTime(),
                        probeInterval: tracker.getProbeInterval(),
                        ...updateData
                    });

                    // record log entry
                    if (updateData.devices && updateData.devices.length > 0) {
                        const point: ActivityPoint = {
                            timestamp: Date.now(),
                            rtt: updateData.devices[0].rtt,
                            avg: updateData.devices[0].avg,
                            state: updateData.devices[0].state,
                            threshold: updateData.threshold
                        };
                        const log = activityLogs.get(signalId) || [];
                        log.push(point);
                        activityLogs.set(signalId, log);
                    }
                };

                io.emit('contact-name', { jid: signalId, name: cleanNumber });
            } catch (err) {
                console.error(err);
                socket.emit('error', { message: 'Failed to start Signal tracking' });
            }
        } else {
            // WhatsApp tracking (original logic)
            const targetJid = cleanNumber + '@s.whatsapp.net';

            if (trackers.has(targetJid)) {
                socket.emit('error', { jid: targetJid, message: 'Already tracking this contact' });
                return;
            }

            try {
                const results = await sock.onWhatsApp(targetJid);
                const result = results?.[0];

                if (result?.exists) {
                    const tracker = new WhatsAppTracker(sock, result.jid);
                    tracker.setProbeMethod(globalProbeMethod);
                    tracker.setProbeInterval(globalProbeInterval);
                    trackers.set(result.jid, { tracker, platform: 'whatsapp' });

                    tracker.onUpdate = (updateData) => {
                        io.emit('tracker-update', {
                            jid: result.jid,
                            platform: 'whatsapp',
                            nextProbeTime: tracker.getNextProbeTime(),
                            probeInterval: tracker.getProbeInterval(),
                            ...updateData
                        });

                        // record log entry
                        if (updateData.devices && updateData.devices.length > 0) {
                            const point: ActivityPoint = {
                                timestamp: Date.now(),
                                rtt: updateData.devices[0].rtt,
                                avg: updateData.devices[0].avg,
                                state: updateData.devices[0].state,
                                threshold: updateData.threshold
                            };
                            const log = activityLogs.get(result.jid) || [];
                            log.push(point);
                            activityLogs.set(result.jid, log);
                        }
                    };

                    tracker.startTracking();

                    const ppUrl = await tracker.getProfilePicture();

                    let contactName = cleanNumber;
                    try {
                        const contactInfo = await sock.onWhatsApp(result.jid);
                        if (contactInfo && contactInfo[0]?.notify) {
                            contactName = contactInfo[0].notify;
                        }
                    } catch (err) {
                        console.log('[NAME] Could not fetch contact name, using number');
                    }

                    socket.emit('contact-added', {
                        jid: result.jid,
                        number: cleanNumber,
                        platform: 'whatsapp'
                    });

                    io.emit('profile-pic', { jid: result.jid, url: ppUrl });
                    io.emit('contact-name', { jid: result.jid, name: contactName });
                } else {
                    socket.emit('error', { jid: targetJid, message: 'Number not on WhatsApp' });
                }
            } catch (err) {
                console.error(err);
                socket.emit('error', { jid: targetJid, message: 'Verification failed' });
            }
        }
    });

    socket.on('remove-contact', (jid: string) => {
        console.log(`Request to stop tracking: ${jid}`);
        const entry = trackers.get(jid);
        if (entry) {
            entry.tracker.stopTracking();
            trackers.delete(jid);
            socket.emit('contact-removed', jid);
        }
    });

    socket.on('set-probe-method', (method: ProbeMethod) => {
        console.log(`Request to change probe method to: ${method}`);
        if (method !== 'delete' && method !== 'reaction') {
            socket.emit('error', { message: 'Invalid probe method' });
            return;
        }

        globalProbeMethod = method;

        for (const entry of trackers.values()) {
            // Only WhatsApp trackers support the delete method
            if (entry.platform === 'whatsapp') {
                (entry.tracker as WhatsAppTracker).setProbeMethod(method);
            }
            // Signal trackers always use reaction method
        }

        io.emit('probe-method', method);
        console.log(`Probe method changed to: ${method}`);
    });

    socket.on('set-probe-interval', (ms: number) => {
        console.log(`Request to change probe interval to ${ms}ms`);
        if (typeof ms !== 'number' || ms < 60000) {
            socket.emit('error', { message: 'Probe interval must be a number >= 60000' });
            return;
        }
        globalProbeInterval = ms;
        for (const entry of trackers.values()) {
            entry.tracker.setProbeInterval(ms);
        }
        io.emit('probe-interval', ms);
        console.log(`Probe interval changed to: ${ms}ms`);
    });
});

const PORT = parseInt(process.env.PORT || '3001', 10);

// Add endpoint for exporting activity logs (JSON)
app.get('/api/activity/:jid', (req, res) => {
    const jid = req.params.jid;
    if (!trackers.has(jid)) {
        return res.status(404).json({ error: 'Contact not tracked' });
    }
    const log = activityLogs.get(jid) || [];
    res.json({ jid, platform: trackers.get(jid)?.platform, log });
});

// handle listen errors (e.g. port already in use)
httpServer.on('error', (err: any) => {
    if (err.code === 'EADDRINUSE') {
        console.error(`[SERVER] Port ${PORT} is already in use. ` +
            `Stop the other process or set a different PORT env variable.`);
        process.exit(1);
    }
    console.error('[SERVER] unexpected error:', err);
});

httpServer.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
