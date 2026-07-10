package mmo.client;

import com.badlogic.gdx.Game;
import mmo.client.audio.AudioEngine;
import mmo.client.net.MasterApi;
import mmo.client.screens.LoginScreen;
import mmo.client.ui.UiKit;
import mmo.client.util.GameConstants;
import mmo.client.util.ItemRegistry;
import mmo.client.world.BlockRegistry;

public class MmoGame extends Game {
    public GameConstants constants;
    public ItemRegistry items;
    public BlockRegistry blocks;
    public MasterApi master;
    public UiKit ui;
    /** lives here (not on the screen) so music survives room transfers */
    public AudioEngine audio;
    /** set after login/character select; used for reconnect + transfers */
    public String characterId;
    public String characterName;

    @Override
    public void create() {
        constants = GameConstants.load();
        items = new ItemRegistry();
        blocks = new BlockRegistry();
        // MMO_MASTER: master origin override (unattended test runs — e.g. a
        // sandboxed session whose IPv4 loopback is fenced targets [::1])
        String masterOrigin = System.getenv("MMO_MASTER");
        master = new MasterApi(masterOrigin != null && !masterOrigin.isBlank() ? masterOrigin : "http://127.0.0.1:4000");
        ui = new UiKit();
        audio = new AudioEngine();
        setScreen(new LoginScreen(this));
    }

    @Override
    public void dispose() {
        super.dispose();
        if (screen != null) screen.dispose();
        ui.dispose();
        audio.dispose();
    }
}
