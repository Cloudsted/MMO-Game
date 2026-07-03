package mmo.client.screens;

import com.badlogic.gdx.Gdx;
import com.badlogic.gdx.Input;
import com.badlogic.gdx.ScreenAdapter;
import com.badlogic.gdx.graphics.Color;
import com.badlogic.gdx.scenes.scene2d.InputEvent;
import com.badlogic.gdx.scenes.scene2d.Stage;
import com.badlogic.gdx.scenes.scene2d.ui.Label;
import com.badlogic.gdx.scenes.scene2d.ui.Table;
import com.badlogic.gdx.scenes.scene2d.ui.TextButton;
import com.badlogic.gdx.scenes.scene2d.ui.TextField;
import com.badlogic.gdx.scenes.scene2d.utils.ClickListener;
import com.badlogic.gdx.utils.ScreenUtils;
import com.badlogic.gdx.utils.viewport.ScreenViewport;
import mmo.client.MmoGame;
import mmo.client.net.GameSocket;
import mmo.client.net.MasterApi;
import mmo.client.net.Protocol;

import java.util.List;

/** Login/registration; on success hands a connected GameSocket to WorldScreen. */
public class LoginScreen extends ScreenAdapter {
    private final MmoGame game;
    private final Stage stage;
    private final TextField username;
    private final TextField password;
    private final Label status;
    private boolean busy = false;

    public LoginScreen(MmoGame game) {
        this.game = game;
        stage = new Stage(new ScreenViewport());
        Gdx.input.setInputProcessor(stage);
        Gdx.input.setCursorCatched(false);

        Table root = new Table();
        root.setFillParent(true);
        stage.addActor(root);

        Label title = new Label("FANTASY MMO", game.ui.label);
        title.setFontScale(2f);

        username = new TextField("", game.ui.textField);
        username.setMessageText("username");
        password = new TextField("", game.ui.textField);
        password.setMessageText("password");
        password.setPasswordMode(true);
        password.setPasswordCharacter('*');

        TextButton loginBtn = new TextButton("  Login  ", game.ui.button);
        TextButton registerBtn = new TextButton("  Register  ", game.ui.button);
        status = new Label("", game.ui.labelDim);

        root.add(title).padBottom(30).row();
        root.add(username).width(260).padBottom(8).row();
        root.add(password).width(260).padBottom(16).row();
        Table buttons = new Table();
        buttons.add(loginBtn).padRight(10);
        buttons.add(registerBtn);
        root.add(buttons).padBottom(12).row();
        root.add(status).row();

        loginBtn.addListener(new ClickListener() {
            @Override
            public void clicked(InputEvent event, float x, float y) { doLogin(); }
        });
        registerBtn.addListener(new ClickListener() {
            @Override
            public void clicked(InputEvent event, float x, float y) { doRegister(); }
        });

        // dev/testing hook: MMO_AUTOLOGIN=user:pass registers (best effort) and logs in
        String auto = System.getenv("MMO_AUTOLOGIN");
        if (auto != null && auto.contains(":")) {
            String[] parts = auto.split(":", 2);
            username.setText(parts[0]);
            password.setText(parts[1]);
            setStatus("auto-login...", false);
            async(() -> {
                try {
                    game.master.register(parts[0], parts[1]);
                } catch (MasterApi.ApiException ignored) {
                    // already registered — fine
                }
            });
            autoLoginPending = true;
        }
    }

    private boolean autoLoginPending = false;

    private void setStatus(String text, boolean error) {
        status.setText(text);
        status.setColor(error ? new Color(1f, 0.45f, 0.45f, 1f) : Color.WHITE);
    }

    /** Runs work off the render thread; onDone is posted back onto it. */
    private void async(Runnable work) {
        if (busy) return;
        busy = true;
        Thread t = new Thread(() -> {
            try {
                work.run();
            } catch (MasterApi.ApiException e) {
                Gdx.app.postRunnable(() -> setStatus(e.getMessage(), true));
            } catch (Exception e) {
                Gdx.app.postRunnable(() -> setStatus("error: " + e.getMessage(), true));
            } finally {
                busy = false;
            }
        }, "net");
        t.setDaemon(true);
        t.start();
    }

    private void doRegister() {
        String user = username.getText().trim();
        String pass = password.getText();
        setStatus("registering...", false);
        async(() -> {
            game.master.register(user, pass);
            Gdx.app.postRunnable(() -> setStatus("registered! now log in.", false));
        });
    }

    private void doLogin() {
        String user = username.getText().trim();
        String pass = password.getText();
        setStatus("logging in...", false);
        async(() -> {
            game.master.login(user, pass);
            Gdx.app.postRunnable(() -> setStatus("loading characters...", false));
            List<MasterApi.Character> chars = game.master.characters();
            MasterApi.Character character;
            if (chars.isEmpty()) {
                String name = user.substring(0, 1).toUpperCase() + user.substring(1);
                MasterApi.Character created;
                try {
                    created = game.master.createCharacter(name);
                } catch (MasterApi.ApiException e) {
                    created = game.master.createCharacter(name + (int) (Math.random() * 1000));
                }
                character = created;
            } else {
                character = chars.get(0); // character-select UI comes later
            }
            game.characterId = character.id();
            game.characterName = character.name();
            Gdx.app.postRunnable(() -> setStatus("entering world as " + character.name() + "...", false));
            MasterApi.EnterGrant grant = game.master.enter(character.id());
            GameSocket socket = new GameSocket(grant.wsUrl());
            try {
                if (!socket.connectBlocking(8, java.util.concurrent.TimeUnit.SECONDS)) {
                    throw new MasterApi.ApiException("could not connect to room server");
                }
            } catch (InterruptedException e) {
                throw new MasterApi.ApiException("connect interrupted");
            }
            socket.sendSafe(Protocol.hello(game.constants.protocolVersion, grant.ticket()));
            Gdx.app.postRunnable(() -> {
                game.setScreen(new WorldScreen(game, socket));
                dispose();
            });
        });
    }

    @Override
    public void render(float delta) {
        if (autoLoginPending && !busy) {
            autoLoginPending = false;
            doLogin();
        }
        // Enter submits
        if (Gdx.input.isKeyJustPressed(Input.Keys.ENTER) && !busy) doLogin();
        ScreenUtils.clear(0.09f, 0.09f, 0.13f, 1f);
        stage.act(delta);
        stage.draw();
    }

    @Override
    public void resize(int width, int height) {
        stage.getViewport().update(width, height, true);
    }

    @Override
    public void dispose() {
        stage.dispose();
    }
}
