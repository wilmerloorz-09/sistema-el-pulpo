<script setup lang="ts">
import { ref, watch } from "vue";

import { PaymentProofApi } from "../services/paymentProofApi";
import type { CaptureUserOption } from "../types/payment-proof";

const props = defineProps<{
  cashSessionId: string;
  api: PaymentProofApi;
  users: CaptureUserOption[];
  initialCaptureUserId?: string | null;
  initialDeviceLabel?: string | null;
}>();

const emit = defineEmits<{
  saved: [{ captureUserId: string | null; captureDeviceLabel: string | null }];
}>();

const captureUserId = ref<string | null>(props.initialCaptureUserId ?? null);
const captureDeviceLabel = ref<string>(props.initialDeviceLabel ?? "");
const loading = ref(false);
const error = ref<string | null>(null);

watch(
  () => props.initialCaptureUserId,
  (value) => {
    captureUserId.value = value ?? null;
  },
);

async function save() {
  loading.value = true;
  error.value = null;
  try {
    const result = await props.api.assignCaptureUser(props.cashSessionId, captureUserId.value, captureDeviceLabel.value || undefined);
    emit("saved", { captureUserId: result.capture_user_id, captureDeviceLabel: result.capture_device_label });
  } catch (err) {
    error.value = err instanceof Error ? err.message : "No se pudo guardar el usuario capturador.";
  } finally {
    loading.value = false;
  }
}
</script>

<template>
  <section class="capture-user-selector">
    <div>
      <h3>Capturador de comprobantes</h3>
      <p>Selecciona el usuario movil que tomara la foto del comprobante de transferencia.</p>
    </div>

    <label>
      Usuario movil
      <select v-model="captureUserId">
        <option :value="null">Sin asignar</option>
        <option v-for="user in users" :key="user.id" :value="user.id">
          {{ user.fullName }} (@{{ user.username }}){{ user.isOnline ? " · en linea" : "" }}
        </option>
      </select>
    </label>

    <label>
      Etiqueta del dispositivo
      <input v-model="captureDeviceLabel" type="text" maxlength="120" placeholder="Ej. Celular caja 1" />
    </label>

    <button type="button" :disabled="loading" @click="save">
      {{ loading ? "Guardando..." : "Guardar capturador" }}
    </button>

    <p v-if="error" class="capture-user-selector__error">{{ error }}</p>
  </section>
</template>

<style scoped>
.capture-user-selector {
  display: grid;
  gap: 10px;
  padding: 16px;
  border-radius: 18px;
  background: #fffaf5;
  border: 1px solid #eadfd2;
}

.capture-user-selector__error {
  color: #b91c1c;
}
</style>
