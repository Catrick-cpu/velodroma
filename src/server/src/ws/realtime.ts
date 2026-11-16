import { WebSocketServer, WebSocket } from 'ws';
import type { Server } from 'node:http';
import jwt from 'jsonwebtoken';

const SECRET = process.env.JWT_SECRET || 'velodroma-dev-secret-change-me';

interface Client { ws: WebSocket; userId?: string; username?: string; room?: string; }
const clients = new Set<Client>();

export function setupRealtime(server: Server) {
  const wss = new WebSocketServer({ server, path: '/ws' });
  wss.on('connection', (ws) => {
    const client: Client = { ws };
    clients.add(client);
    ws.on('message', (raw) => {
      try {
        const msg = JSON.parse(raw.toString());
        handleMessage(client, msg);
      } catch {}
    });
    ws.on('close', () => {
      if (client.userId) broadcast({ type: 'player_left', player_id: client.userId || '' }, client);
      clients.delete(client);
    });
  });
  return wss;
}

function send(ws: WebSocket, data: any) {
  if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(data));
}
function broadcast(data: any, except?: Client) {
  for (const c of clients) if (c !== except) send(c.ws, data);
}
function broadcastRoom(room: string, data: any, except?: Client) {
  for (const c of clients) if (c.room === room && c !== except) send(c.ws, data);
}

function handleMessage(client: Client, msg: any) {
  switch (msg.type) {
    case 'auth': {
      try {
        const payload = jwt.verify(String(msg.token||''), SECRET) as any;
        client.userId = String(payload?.id || '');
        client.username = String(msg.name || payload?.username || 'Rider');
        send(client.ws, { type: 'auth_success', player_id: client.userId || '' });
      } catch {
        send(client.ws, { type: 'auth_failed', reason: 'Invalid token' });
      }
      break;
    }
    case 'ping':
      send(client.ws, { type: 'pong', timestamp: Date.now() });
      break;
    case 'player_update':
      if (client.room) broadcastRoom(String(client.room), { type: 'player_update', player_id: client.userId || '', data: msg }, client);
      else broadcast({ type: 'player_update', player_id: client.userId || '', data: msg }, client);
      break;
    case 'chat':
      broadcast({ type: 'chat', player_id: client.userId || '', player_name: client.username || 'Rider', message: String(msg.message || '').slice(0, 500) }, client);
      break;
    case 'join_group_ride':
      client.room = msg.ride_id || 'global';
      broadcastRoom(String(client.room), { type: 'player_joined', player_id: client.userId || '', data: { name: client.username } }, client);
      send(client.ws, { type: 'group_ride_update', data: { joined: client.room } });
      break;
    case 'leave_group_ride':
      if (client.room) broadcastRoom(String(client.room), { type: 'player_left', player_id: client.userId || '' }, client);
      client.room = undefined;
      break;
    case 'ride_event':
      // echo/route analytics and segment events (server-side persistence could be added)
      send(client.ws, { type: 'ride_event_ack', event_type: msg.event_type });
      break;
    case 'set_name':
      client.username = String(msg.name || client.username);
      break;
    default:
      break;
  }
}
