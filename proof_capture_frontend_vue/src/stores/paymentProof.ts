import { computed, ref } from "vue";
import { defineStore } from "pinia";

import { PaymentProofApi } from "../services/paymentProofApi";
import type { CaptureRequestSummary, MobileCaptureRequestView, PaymentProofSummary } from "../types/payment-proof";
import { prepareProofImage } from "../utils/prepareProofImage";

export const usePaymentProofStore = defineStore("paymentProof", () => {
  const api = ref<PaymentProofApi | null>(null);
  const captureRequest = ref<CaptureRequestSummary | null>(null);
  const mobileCaptureView = ref<MobileCaptureRequestView | null>(null);
  const currentProof = ref<PaymentProofSummary | null>(null);
  const previewUrl = ref<string | null>(null);
  const selectedFile = ref<File | null>(null);
  const uploadStatus = ref<"idle" | "loading" | "success" | "error">("idle");
  const selectionStatus = ref<"idle" | "loading" | "error">("idle");
  const errors = ref<string[]>([]);

  function configure(client: PaymentProofApi) {
    api.value = client;
  }

  function ensureApi() {
    if (!api.value) throw new Error("PaymentProofApi no configurada.");
    return api.value;
  }

  async function setSelectedFile(file: File) {
    clearSelectedFile();
    selectionStatus.value = "loading";
    errors.value = [];

    try {
      const preparedFile = await prepareProofImage(file);
      selectedFile.value = preparedFile;
      previewUrl.value = URL.createObjectURL(preparedFile);
      selectionStatus.value = "idle";
    } catch (error) {
      selectionStatus.value = "error";
      errors.value = [error instanceof Error ? error.message : "No se pudo preparar la imagen."];
      throw error;
    }
  }

  function clearSelectedFile() {
    if (previewUrl.value) URL.revokeObjectURL(previewUrl.value);
    previewUrl.value = null;
    selectedFile.value = null;
    selectionStatus.value = "idle";
  }

  async function createCaptureRequest(paymentId: string) {
    captureRequest.value = await ensureApi().createCaptureRequest(paymentId);
    return captureRequest.value;
  }

  async function fetchCaptureRequest(token: string) {
    mobileCaptureView.value = await ensureApi().fetchCaptureRequest(token);
    captureRequest.value = mobileCaptureView.value.capture_request;
    return mobileCaptureView.value;
  }

  async function openCaptureRequest(token: string) {
    captureRequest.value = await ensureApi().openCaptureRequest(token);
    return captureRequest.value;
  }

  async function uploadSelectedFile(token: string) {
    if (!selectedFile.value) {
      errors.value = ["Selecciona una foto antes de continuar."];
      return null;
    }
    uploadStatus.value = "loading";
    errors.value = [];
    try {
      const response = await ensureApi().uploadCaptureRequest(token, selectedFile.value);
      captureRequest.value = response.capture_request ?? null;
      currentProof.value = response.proof ?? null;
      uploadStatus.value = "success";
      clearSelectedFile();
      return response;
    } catch (error) {
      uploadStatus.value = "error";
      errors.value = [error instanceof Error ? error.message : "No se pudo subir la imagen."];
      throw error;
    }
  }

  async function approveProof(paymentId: string) {
    const proof = await ensureApi().approveProof(paymentId);
    currentProof.value = proof;
    if (captureRequest.value) {
      captureRequest.value = {
        ...captureRequest.value,
        status: "approved",
        approved_at: proof.validated_at ?? new Date().toISOString(),
      };
    }
    return proof;
  }

  async function rejectProof(paymentId: string, reason: string) {
    const response = await ensureApi().rejectProof(paymentId, reason);
    currentProof.value = response.proof ?? null;
    captureRequest.value = response.capture_request ?? null;
    return response;
  }

  async function fetchCurrentProof(paymentId: string) {
    const response = await ensureApi().getPaymentProof(paymentId);
    currentProof.value = response.proof ?? null;
    captureRequest.value = response.capture_request ?? null;
    return response;
  }

  const hasLocalPreview = computed(() => Boolean(previewUrl.value));

  return {
    captureRequest,
    mobileCaptureView,
    uploadStatus,
    previewUrl,
    currentProof,
    errors,
    hasLocalPreview,
    selectionStatus,
    configure,
    createCaptureRequest,
    fetchCaptureRequest,
    openCaptureRequest,
    setSelectedFile,
    clearSelectedFile,
    uploadSelectedFile,
    approveProof,
    rejectProof,
    fetchCurrentProof,
  };
});
