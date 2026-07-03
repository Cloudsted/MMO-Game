package mmo.client.net;

import com.google.gson.JsonObject;
import org.java_websocket.client.WebSocketClient;
import org.java_websocket.handshake.ServerHandshake;

import java.net.URI;
import java.util.Queue;
import java.util.concurrent.ConcurrentLinkedQueue;

/**
 * Gameplay WebSocket to a RoomHost. Messages arrive on the socket thread and
 * are queued; the render thread drains {@link #poll()} once per frame.
 */
public class GameSocket extends WebSocketClient {
    private final Queue<JsonObject> inbox = new ConcurrentLinkedQueue<>();
    private volatile boolean closed = false;
    private volatile String closeReason = null;

    public GameSocket(String wsUrl) {
        super(URI.create(wsUrl));
        setConnectionLostTimeout(30);
    }

    @Override
    public void onOpen(ServerHandshake handshake) {}

    @Override
    public void onMessage(String message) {
        try {
            inbox.add(Protocol.parse(message));
        } catch (Exception ignored) {
            // malformed frame — drop it, the server keyframes will resync us
        }
    }

    @Override
    public void onClose(int code, String reason, boolean remote) {
        closed = true;
        closeReason = reason == null || reason.isEmpty() ? "connection closed" : reason;
    }

    @Override
    public void onError(Exception ex) {
        closed = true;
        closeReason = ex.getMessage();
    }

    /** Next queued server message, or null. Render thread only. */
    public JsonObject poll() {
        return inbox.poll();
    }

    public boolean isClosed() {
        return closed;
    }

    public String getCloseReason() {
        return closeReason;
    }

    public void sendSafe(String text) {
        if (!closed && isOpen()) send(text);
    }
}
