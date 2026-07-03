package mmo.client.net;

import com.google.gson.Gson;
import com.google.gson.JsonArray;
import com.google.gson.JsonObject;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import java.util.ArrayList;
import java.util.List;

/**
 * Blocking HTTP client for the master server API. Call from a worker thread,
 * never the render thread (see LoginScreen's async helper).
 */
public class MasterApi {
    private final String baseUrl;
    // HTTP/1.1 forced: the default HTTP/2 mode sends an Upgrade: h2c header,
    // which Node hands to the master's WebSocket upgrade path instead of the API
    private final HttpClient http = HttpClient.newBuilder()
        .version(HttpClient.Version.HTTP_1_1)
        .connectTimeout(Duration.ofSeconds(5))
        .build();
    private final Gson gson = new Gson();
    private String token;

    public static class ApiException extends RuntimeException {
        public ApiException(String message) { super(message); }
    }

    public record Character(String id, String name, int level, double xp, double gold, String roomId) {}
    public record EnterGrant(String wsUrl, String roomId, String ticket) {}

    public MasterApi(String baseUrl) {
        this.baseUrl = baseUrl;
    }

    private JsonObject call(String method, String path, JsonObject body) {
        try {
            HttpRequest.Builder rb = HttpRequest.newBuilder()
                .uri(URI.create(baseUrl + path))
                .timeout(Duration.ofSeconds(10))
                .header("content-type", "application/json");
            if (token != null) rb.header("authorization", "Bearer " + token);
            if (body != null) rb.method(method, HttpRequest.BodyPublishers.ofString(gson.toJson(body)));
            else rb.method(method, HttpRequest.BodyPublishers.noBody());
            HttpResponse<String> res = http.send(rb.build(), HttpResponse.BodyHandlers.ofString());
            JsonObject json = gson.fromJson(res.body(), JsonObject.class);
            if (res.statusCode() >= 400) {
                String error = json != null && json.has("error") ? json.get("error").getAsString() : "HTTP " + res.statusCode();
                throw new ApiException(error);
            }
            return json;
        } catch (ApiException e) {
            throw e;
        } catch (java.net.ConnectException e) {
            throw new ApiException("cannot reach server — is the dev stack running? (npm run dev)");
        } catch (Exception e) {
            throw new ApiException("network error: " + e.getMessage());
        }
    }

    public void register(String username, String password) {
        JsonObject body = new JsonObject();
        body.addProperty("username", username);
        body.addProperty("password", password);
        call("POST", "/api/register", body);
    }

    /** Logs in and remembers the session token for subsequent calls. */
    public void login(String username, String password) {
        JsonObject body = new JsonObject();
        body.addProperty("username", username);
        body.addProperty("password", password);
        JsonObject res = call("POST", "/api/login", body);
        token = res.get("token").getAsString();
    }

    public List<Character> characters() {
        JsonArray arr = call("GET", "/api/characters", null).getAsJsonArray("characters");
        List<Character> out = new ArrayList<>();
        for (var el : arr) out.add(toCharacter(el.getAsJsonObject()));
        return out;
    }

    public Character createCharacter(String name) {
        JsonObject body = new JsonObject();
        body.addProperty("name", name);
        return toCharacter(call("POST", "/api/characters", body).getAsJsonObject("character"));
    }

    public EnterGrant enter(String characterId) {
        JsonObject body = new JsonObject();
        body.addProperty("characterId", characterId);
        JsonObject res = call("POST", "/api/enter", body);
        return new EnterGrant(res.get("wsUrl").getAsString(), res.get("roomId").getAsString(), res.get("ticket").getAsString());
    }

    private Character toCharacter(JsonObject o) {
        return new Character(
            o.get("id").getAsString(),
            o.get("name").getAsString(),
            o.get("level").getAsInt(),
            o.get("xp").getAsDouble(),
            o.get("gold").getAsDouble(),
            o.get("roomId").getAsString());
    }
}
