package mmo.client;

import com.badlogic.gdx.Game;
import mmo.client.net.MasterApi;
import mmo.client.screens.LoginScreen;
import mmo.client.ui.UiKit;
import mmo.client.util.GameConstants;

public class MmoGame extends Game {
    public GameConstants constants;
    public MasterApi master;
    public UiKit ui;
    /** set after login/character select; used for reconnect + transfers */
    public String characterId;
    public String characterName;

    @Override
    public void create() {
        constants = GameConstants.load();
        master = new MasterApi("http://127.0.0.1:4000");
        ui = new UiKit();
        setScreen(new LoginScreen(this));
    }

    @Override
    public void dispose() {
        super.dispose();
        if (screen != null) screen.dispose();
        ui.dispose();
    }
}
