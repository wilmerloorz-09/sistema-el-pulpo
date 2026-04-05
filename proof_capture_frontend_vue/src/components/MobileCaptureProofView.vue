<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from "vue";

import { usePaymentProofStore } from "../stores/paymentProof";

const props = defineProps<{
  token: string;
}>();

const store = usePaymentProofStore();
const loading = ref(true);
const successMessage = ref<string | null>(null);

async function loadRequest() {
  loading.value = true;
  successMessage.value = null;
  try {
    await store.fetchCaptureRequest(props.token);
    await store.openCaptureRequest(props.token);
  } finally {
    loading.value = false;
  }
}

function handleFileChange(event: Event) {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  if (!file) return;
  store.setSelectedFile(file);
}

function retake() {
  store.clearSelectedFile();
  successMessage.value = null;
}

async function confirmPhoto() {
  await store.uploadSelectedFile(props.token);
  successMessage.value = "Comprobante enviado correctamente.";
}

onMounted(() => {
  void loadRequest();
});

onBeforeUnmount(() => {
  store.clearSelectedFile();
});
</script>

<template>
  <section class="mobile-capture-proof">
    <div v-if="loading">Cargando solicitud...</div>

    <template v-else>
      <header v-if="store.mobileCaptureView">
        <h2>Capturar comprobante</h2>
        <p>Pago {{ store.mobileCaptureView.payment.payment_id }}</p>
        <p>{{ store.mobileCaptureView.payment.payment_method_name }} · {{ store.mobileCaptureView.payment.amount }}</p>
      </header>

      <label class="mobile-capture-proof__picker">
        <span>Tomar foto</span>
        <input type="file" accept="image/*" capture="environment" @change="handleFileChange" />
      </label>

      <div v-if="store.previewUrl" class="mobile-capture-proof__preview">
        <img :src="store.previewUrl" alt="Preview del comprobante" />
      </div>

      <div class="mobile-capture-proof__actions">
        <button type="button" :disabled="!store.previewUrl" @click="confirmPhoto">
          {{ store.uploadStatus === "loading" ? "Subiendo..." : "Usar foto" }}
        </button>
        <button type="button" :disabled="!store.previewUrl" @click="retake">Volver a tomar</button>
      </div>

      <p v-if="successMessage" class="mobile-capture-proof__success">{{ successMessage }}</p>
      <p v-if="store.errors.length" class="mobile-capture-proof__error">{{ store.errors[0] }}</p>
    </template>
  </section>
</template>

<style scoped>
.mobile-capture-proof {
  display: grid;
  gap: 12px;
  padding: 18px;
  min-height: 100vh;
  background: linear-gradient(180deg, #fffaf5 0%, #f4ede6 100%);
}

.mobile-capture-proof__picker {
  display: inline-flex;
  justify-content: center;
  align-items: center;
  min-height: 52px;
  border-radius: 16px;
  background: #3b2d24;
  color: white;
}

.mobile-capture-proof__picker input {
  display: none;
}

.mobile-capture-proof__preview img {
  width: 100%;
  border-radius: 18px;
  object-fit: cover;
  border: 1px solid #dccab7;
}

.mobile-capture-proof__actions {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px;
}

.mobile-capture-proof__success {
  color: #15803d;
}

.mobile-capture-proof__error {
  color: #b91c1c;
}
</style>
