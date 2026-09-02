package com.sistemaelpulpo.app.plugins;

import android.content.ActivityNotFoundException;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.print.PrintAttributes;
import android.print.PrintDocumentAdapter;
import android.print.PrintManager;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

@CapacitorPlugin(name = "PulpoPrint")
public class PulpoPrintPlugin extends Plugin {

    private static final String EPSON_IPRINT_PACKAGE = "epson.print";

    @PluginMethod
    public void printWebView(PluginCall call) {
        String jobName = call.getString("jobName", "Reporte de caja");

        bridge.getActivity().runOnUiThread(() -> {
            try {
                Context context = getContext();
                PrintManager printManager = (PrintManager) context.getSystemService(Context.PRINT_SERVICE);
                if (printManager == null) {
                    call.reject("PrintManager no disponible en este dispositivo");
                    return;
                }

                PrintDocumentAdapter adapter = bridge.getWebView().createPrintDocumentAdapter(jobName);
                printManager.print(jobName, adapter, new PrintAttributes.Builder().build());
                call.resolve();
            } catch (Exception error) {
                call.reject("No se pudo abrir impresion: " + error.getMessage(), error);
            }
        });
    }

    /** Abre un HTML en Epson iPrint (ACTION_VIEW). Si no esta instalada, muestra apps compatibles. */
    @PluginMethod
    public void openHtmlInEpsonIPrint(PluginCall call) {
        String uriString = call.getString("uri");
        if (uriString == null || uriString.trim().isEmpty()) {
            call.reject("uri es obligatorio");
            return;
        }

        bridge.getActivity().runOnUiThread(() -> {
            try {
                Uri uri = Uri.parse(uriString);
                Intent viewIntent = new Intent(Intent.ACTION_VIEW);
                viewIntent.setDataAndType(uri, "text/html");
                viewIntent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
                viewIntent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);

                try {
                    getContext().grantUriPermission(
                        EPSON_IPRINT_PACKAGE,
                        uri,
                        Intent.FLAG_GRANT_READ_URI_PERMISSION
                    );
                } catch (Exception ignored) {
                    /* package not installed yet */
                }

                Intent launchIntent = new Intent(viewIntent);
                launchIntent.setPackage(EPSON_IPRINT_PACKAGE);

                JSObject result = new JSObject();
                try {
                    getActivity().startActivity(launchIntent);
                    result.put("opened", true);
                    result.put("usedChooser", false);
                    result.put("package", EPSON_IPRINT_PACKAGE);
                    call.resolve(result);
                    return;
                } catch (ActivityNotFoundException notInstalled) {
                    launchIntent.setPackage(null);
                    Intent chooser = Intent.createChooser(launchIntent, "Abrir reporte con");
                    getActivity().startActivity(chooser);
                    result.put("opened", true);
                    result.put("usedChooser", true);
                    result.put("package", "");
                    call.resolve(result);
                }
            } catch (Exception error) {
                call.reject("No se pudo abrir Epson iPrint: " + error.getMessage(), error);
            }
        });
    }
}
