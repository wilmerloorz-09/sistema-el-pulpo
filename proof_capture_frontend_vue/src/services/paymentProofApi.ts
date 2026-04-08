import type {
  ApiResponse,
  CaptureRequestSummary,
  MobileCaptureRequestView,
  PaymentProofSummary,
  PaymentProofWithRequest,
  SignedProofUrlResponse,
  PendingCaptureRequestItem,
} from "../types/payment-proof";

export interface PaymentProofApiOptions {
  baseUrl: string;
  getAccessToken: () => Promise<string>;
}

export class PaymentProofApi {
  constructor(private readonly options: PaymentProofApiOptions) {}

  private async request<T>(path: string, init?: RequestInit, requiresAuth = true): Promise<T> {
    const token = requiresAuth ? await this.options.getAccessToken() : null;
    const response = await fetch(`${this.options.baseUrl}${path}`, {
      ...init,
      headers: {
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(init?.body instanceof FormData ? {} : { "Content-Type": "application/json" }),
        ...(init?.headers ?? {}),
      },
    });

    const payload = (await response.json()) as ApiResponse<T>;
    if (!response.ok || !payload.success) {
      throw new Error(payload.message || "No se pudo completar la solicitud.");
    }
    return payload.data;
  }

  assignCaptureUser(cashSessionId: string, captureUserId: string | null, captureDeviceLabel?: string) {
    return this.request<{ cash_session_id: string; capture_user_id: string | null; capture_device_label: string | null }>(
      `/api/cash-sessions/${cashSessionId}/capture-user`,
      {
        method: "POST",
        body: JSON.stringify({ capture_user_id: captureUserId, capture_device_label: captureDeviceLabel ?? null }),
      },
    );
  }

  createCaptureRequest(paymentId: string) {
    return this.request<CaptureRequestSummary>(`/api/payments/${paymentId}/capture-request`, { method: "POST" });
  }

  fetchCaptureRequest(token: string) {
    return this.request<MobileCaptureRequestView>(`/api/capture-requests/${token}`);
  }

  openCaptureRequest(token: string) {
    return this.request<CaptureRequestSummary>(`/api/capture-requests/${token}/open`, { method: "POST" });
  }

  async uploadCaptureRequest(token: string, file: File) {
    const formData = new FormData();
    formData.append("file", file);
    const accessToken = await this.options.getAccessToken();
    return this.request<PaymentProofWithRequest>(`/api/capture-requests/${token}/upload`, {
      method: "POST",
      body: formData,
      headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : undefined,
    }, false);
  }

  getPaymentProof(paymentId: string) {
    return this.request<PaymentProofWithRequest>(`/api/payments/${paymentId}/proof`);
  }

  approveProof(paymentId: string) {
    return this.request<PaymentProofSummary>(`/api/payments/${paymentId}/proof/approve`, { method: "POST" });
  }

  rejectProof(paymentId: string, reason: string) {
    return this.request<PaymentProofWithRequest>(`/api/payments/${paymentId}/proof/reject`, {
      method: "POST",
      body: JSON.stringify({ reason }),
    });
  }

  getProofViewUrl(paymentId: string) {
    return this.request<SignedProofUrlResponse>(`/api/payments/${paymentId}/proof/view-url`);
  }

  getPendingCaptureRequests(cashSessionId: string) {
    return this.request<PendingCaptureRequestItem[]>(`/api/cash-sessions/${cashSessionId}/capture-requests/pending`);
  }
}
