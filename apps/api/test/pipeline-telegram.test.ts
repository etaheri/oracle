import { describe, expect, it, vi } from "vitest";
import { makeTelegramClient } from "../src/pipeline/telegram";

describe("makeTelegramClient", () => {
  it("no-ops (and never throws) when botToken/chatId are missing", async () => {
    const client = makeTelegramClient(undefined, undefined);
    await expect(client.send("hello")).resolves.toBeUndefined();
  });

  it("logs but never throws when fetch rejects", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const fetchFn = vi.fn(async () => {
      throw new Error("network down");
    });
    const client = makeTelegramClient("tok", "chat", fetchFn as unknown as typeof fetch);
    await expect(client.send("hello")).resolves.toBeUndefined();
    expect(errorSpy).toHaveBeenCalled();
    errorSpy.mockRestore();
  });

  it("logs a non-2xx Telegram response instead of swallowing it silently", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const fetchFn = vi.fn(
      async () => new Response("bad chat id", { status: 400, statusText: "Bad Request" }),
    );
    const client = makeTelegramClient("tok", "chat", fetchFn as unknown as typeof fetch);

    await expect(client.send("hello")).resolves.toBeUndefined();

    expect(errorSpy).toHaveBeenCalledWith("[telegram] send failed:", 400, "bad chat id");
    errorSpy.mockRestore();
  });
});
