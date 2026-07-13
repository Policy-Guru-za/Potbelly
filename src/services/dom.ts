export function requiredElement<T extends Element>(selector: string, root: ParentNode = document): T {
  const element = root.querySelector<T>(selector);
  if (!element) throw new Error(`Required element is missing: ${selector}`);
  return element;
}

export function setLiveMessage(message: string): void {
  const region = document.querySelector<HTMLElement>("#appStatus");
  if (region) region.textContent = message;
}

export function debounce(callback: () => void, delay: number): () => void {
  let timer = 0;
  return () => {
    clearTimeout(timer);
    timer = window.setTimeout(callback, delay);
  };
}
