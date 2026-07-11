package mmo.client;

import com.badlogic.gdx.Game;
import mmo.client.audio.AudioEngine;
import mmo.client.net.MasterApi;
import mmo.client.screens.LoginScreen;
import mmo.client.ui.UiKit;
import mmo.client.util.ClientSettings;
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
    /** persisted client-local options (audio sliders) — see ClientSettings */
    public ClientSettings settings;
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
        settings = ClientSettings.load();
        // test hook: MMO_SET_VOLUMES=master,music,ambience,sfx (0..1 each)
        // drives the REAL settings save path, so a later launch WITHOUT the
        // hook proves persistence (input can't be injected into GLFW windows)
        String setVols = System.getenv("MMO_SET_VOLUMES");
        if (setVols != null) {
            try {
                String[] p = setVols.split(",");
                settings.masterVol = Float.parseFloat(p[0].trim());
                settings.musicVol = Float.parseFloat(p[1].trim());
                settings.ambienceVol = Float.parseFloat(p[2].trim());
                settings.sfxVol = Float.parseFloat(p[3].trim());
                settings.save();
            } catch (Exception ignored) {}
        }
        audio = new AudioEngine();
        audio.setVolumes(settings.masterVol, settings.musicVol, settings.ambienceVol, settings.sfxVol);
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
