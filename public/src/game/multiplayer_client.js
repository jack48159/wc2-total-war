import { apiUrl, authFetch, authToken, GAME_ACCESS_KEY } from '../core/auth.js';

export async function multiplayerRequest(path, method = 'GET', body = null) {
  const response = await authFetch(`/api/mp/${path}`, { method, ...(body == null ? {} : { body: JSON.stringify(body) }) });
  const data = await response.json();
  if (!response.ok) {
    const error = new Error(data.error || `联机服务返回 ${response.status}`);
    error.code = data.code || null;
    error.hint = data.hint || null;
    error.status = response.status;
    throw error;
  }
  return data;
}

export async function enterMultiplayerRoom(roomId, role = 'player', request = multiplayerRequest) {
  if (role === 'spectator') return request(`rooms/${roomId}/spectate`, 'POST');
  try { return await request(`rooms/${roomId}`); }
  catch (error) {
    if (error.code !== 'not_in_room' && !error.message?.startsWith('尚未加入房间')) throw error;
    return request(`rooms/${roomId}/join`, 'POST');
  }
}

export class MultiplayerClient {
  constructor(roomId, onRoom, onError = console.error, options = {}) {
    this.roomId = roomId;
    this.onRoom = onRoom;
    this.onError = onError;
    this.spectator = !!options.spectator;
    this.connect();
  }
  connect() {
    const url = new URL(apiUrl('/api/mp/live'));
    url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
    this.socket = new WebSocket(url);
    this.socket.onopen = () => this.socket.send(JSON.stringify({ type: 'subscribe', roomId: this.roomId, token: authToken(), accessKey: GAME_ACCESS_KEY, spectator:this.spectator }));
    this.socket.onmessage = event => {
      try {
        const packet = JSON.parse(event.data);
        if (packet.type === 'roomClosed') { this.close(); this.onRoom(packet); }
        else if (packet.type === 'room' || packet.type === 'notice') this.onRoom(packet);
      }
      catch (error) { this.onError(error); }
    };
    this.socket.onerror = () => this.onError(new Error('联机连接中断'));
    this.socket.onclose = () => {
      if (this.closed) return;
      this.retry = setTimeout(() => this.connect(), 1800);
    };
  }
  command(command) { return multiplayerRequest(`rooms/${this.roomId}/command`, 'POST', { command }); }
  room() { return multiplayerRequest(`rooms/${this.roomId}`); }
  close() { this.closed = true; clearTimeout(this.retry); this.socket?.close(); }
}
