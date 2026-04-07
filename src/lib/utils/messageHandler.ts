/**
 * Returns true if the message is exactly "done" (case-insensitive, ignoring surrounding whitespace).
 */
export function isDoneMessage(message: string): boolean {
  return message.trim().toLowerCase() === "done";
}
