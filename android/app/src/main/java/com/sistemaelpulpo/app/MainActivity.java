package com.sistemaelpulpo.app;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;
import com.sistemaelpulpo.app.plugins.PulpoPrintPlugin;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(PulpoPrintPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
