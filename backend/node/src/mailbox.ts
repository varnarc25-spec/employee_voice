import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export interface MailboxItem {
  createdAt: string;
  purpose: string;
  token: string;
  maskedRecipient: string;
}

const filePath = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", ".local", "dev-mailbox.jsonl");

export function appendMailbox(item: MailboxItem): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.appendFileSync(filePath, `${JSON.stringify(item)}\n`);
}

export function recentMailbox(take = 20): MailboxItem[] {
  if (!fs.existsSync(filePath)) return [];
  return fs.readFileSync(filePath, "utf8").trim().split("\n").filter(Boolean).slice(-take).reverse().map((line) => JSON.parse(line) as MailboxItem);
}
