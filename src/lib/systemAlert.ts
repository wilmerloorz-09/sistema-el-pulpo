export function showSystemAlert(title: string, message: string) {
  window.dispatchEvent(new CustomEvent("global-alert", { detail: { title, message } }));
}
