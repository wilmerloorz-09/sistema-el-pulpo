<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from "vue";

import type { PaymentProofApi } from "../services/paymentProofApi";
import { usePaymentProofStore } from "../stores/paymentProof";

const props = withDefaults(
  defineProps<{
    paymentId: string;
    api: PaymentProofApi;
    pollMs?: number;
    allowApprove?: boolean;
    allowReject?: boolean;
  }>(),
  {
    pollMs: 12000,
    allowApprove: true,
    allowReject: true,
  },
);

const store = usePaymentProofStore();
const rejectReason = ref("");
const viewUrl = ref<string | null>(null);
let pollHandle: number | null = null;

const statusLabel = computed(() => {
  if (store.currentProof?.validation_status === "approved") return "Aprobado";
  if (store.currentProof?.validation_status === "rejected") return "Rechazado";
  if (store.captureRequest?.status === "uploaded") return "Pendiente de validar";
  if (store.captureRequest?.status === "pending" || store.captureRequest?.status === "opened") return "Esperando foto";
  return "Sin comprobante";
});

async function refresh() {
  await store.fetchCurrentProof(props.paymentId);
}

async function requestPhoto() {
  await store.createCaptureRequest(props.paymentId);
}

async function openProof() {
  const signed = await props.api.getProofViewUrl(props.paymentId);
  viewUrl.value = signed.url;
  window.open(signed.url, "_blank", "noopener,noreferrer");
}

async function approve() {
  await store.approveProof(props.paymentId);
}

async function reject() {
  if (!rejectReason.value.trim()) return;
  await store.rejectProof(props.paymentId, rejectReason.value.trim());
  rejectReason.value = "";
}

onMounted(async () => {
  await refresh();
  pollHandle = window.setInterval(() => {
    void refresh();
  }, props.pollMs);
});

onUnmounted(() => {
  if (pollHandle) window.clearInterval(pollHandle);
});
</script>

<template>
  <section class="transfer-proof-panel">
    <header class="transfer-proof-panel__header">
      <div>
        <h3>Comprobante de transferencia</h3>
        <p>{{ statusLabel }}</p>
      </div>
      <span class="transfer-proof-panel__badge">{{ store.captureRequest?.status ?? "sin-solicitud" }}</span>
    </header>

    <div v-if="store.currentProof" class="transfer-proof-panel__proof">
      <p>{{ store.currentProof.original_file_name || store.currentProof.file_name_stored }}</p>
      <p>{{ store.currentProof.mime_type }} · {{ Math.round(store.currentProof.file_size / 1024) }} KB</p>
    </div>

    <div class="transfer-proof-panel__actions">
      <button type="button" @click="requestPhoto">Solicitar foto</button>
      <button type="button" @click="refresh">Actualizar</button>
      <button type="button" :disabled="!store.currentProof" @click="openProof">Ver comprobante</button>
      <button v-if="allowApprove" type="button" :disabled="store.captureRequest?.status !== 'uploaded'" @click="approve">
        Aprobar comprobante
      </button>
    </div>

    <div v-if="allowReject" class="transfer-proof-panel__reject">
      <textarea v-model="rejectReason" rows="2" placeholder="Motivo del rechazo"></textarea>
      <button type="button" :disabled="store.captureRequest?.status !== 'uploaded'" @click="reject">
        Rechazar y pedir otra
      </button>
    </div>

    <p v-if="store.errors.length" class="transfer-proof-panel__error">{{ store.errors[0] }}</p>
    <a v-if="viewUrl" :href="viewUrl" target="_blank" rel="noopener noreferrer">Abrir comprobante temporal</a>
  </section>
</template>

<style scoped>
.transfer-proof-panel {
  display: grid;
  gap: 12px;
  padding: 16px;
  border: 1px solid #eadfd2;
  border-radius: 18px;
  background: #fffaf5;
}

.transfer-proof-panel__header,
.transfer-proof-panel__actions {
  display: flex;
  gap: 12px;
  justify-content: space-between;
  align-items: center;
  flex-wrap: wrap;
}

.transfer-proof-panel__actions {
  justify-content: flex-start;
}

.transfer-proof-panel__badge {
  padding: 4px 10px;
  border-radius: 999px;
  background: #3b2d24;
  color: white;
  font-size: 12px;
}

.transfer-proof-panel__reject {
  display: grid;
  gap: 8px;
}

.transfer-proof-panel__error {
  color: #b91c1c;
}
</style>
