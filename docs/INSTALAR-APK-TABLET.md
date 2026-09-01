# Generar APK para la tablet

La app de la tablet debe reinstalarse para poder imprimir reportes (plugin Compartir).

## Opcion A: Descargar desde GitHub (recomendado)

1. Abra https://github.com/wilmerloorz-09/sistema-el-pulpo/actions/workflows/android-apk.yml
2. Entre al workflow **Build Android APK** (ultima ejecucion en verde)
3. Baje el artefacto **sistema-el-pulpo-debug-apk**
4. Descomprima el ZIP: dentro esta `app-debug.apk`
5. Copie el APK a la tablet e instalelo (permite instalar apps desconocidas si pregunta)
6. Abra la app nueva y pruebe Imprimir en el reporte de caja

Si no hay ejecucion reciente, en Actions pulse **Run workflow** → **Run workflow**.

La ultima ejecucion exitosa del workflow genera el APK con el plugin **Compartir** incluido.

## Opcion B: Compilar en esta PC

Requiere [Android Studio](https://developer.android.com/studio) instalado.

```powershell
npm run android:apk
```

APK generado en:

`android\app\build\outputs\apk\debug\app-debug.apk`

## Mientras no reinstale la app

En el reporte de caja use:

- **Abrir en navegador** → menu tres puntos → Imprimir → Epson L395
- **Copiar resumen** o **Enviar por correo**
- Imprimir desde **PC** con la Epson conectada
