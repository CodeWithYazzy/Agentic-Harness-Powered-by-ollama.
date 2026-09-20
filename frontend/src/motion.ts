// Centralized motion system — ONE coherent language. No random transitions.
export const easeOut = [0.22, 1, 0.36, 1] as const;

// Popover: opacity 0->1, scale .98->1, translateY -3->0, 150-200ms
export const popoverAnim = {
  initial: { opacity: 0, scale: 0.98, y: -3 },
  animate: { opacity: 1, scale: 1, y: 0 },
  exit: { opacity: 0, scale: 0.98, y: -3 },
  transition: { duration: 0.17, ease: easeOut as unknown as number[] },
};
// Window launch: fade in, 98%->100%, slight rise
export const windowAnim = {
  initial: { opacity: 0, scale: 0.98, y: 10 },
  animate: { opacity: 1, scale: 1, y: 0 },
  transition: { duration: 0.24, ease: easeOut as unknown as number[] },
};
// Messages: slight fade + rise, no bounce
export const msgAnim = {
  initial: { opacity: 0, y: 6 },
  animate: { opacity: 1, y: 0 },
  transition: { duration: 0.18, ease: easeOut as unknown as number[] },
};
