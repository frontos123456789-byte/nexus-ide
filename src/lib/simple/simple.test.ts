import { describe, expect, it } from "vitest";
import { detectIntent, suggestName } from "./intent";
import { friendlyError } from "./projects";
import { slideCountFrom, themeFor } from "@/components/simple/wizards/DeckWizard";

describe("detectIntent", () => {
  it("routes plain-language requests to the right creator", () => {
    expect(detectIntent("Хочу красивый сайт для продажи домашних тортов")).toBe("site");
    expect(detectIntent("Сделай презентацию про космос на 10 слайдов")).toBe("presentation");
    expect(detectIntent("Сделай Telegram-бота для записи клиентов")).toBe("bot");
    expect(detectIntent("Сделай приложение для записи клиентов в парикмахерскую")).toBe("app");
    expect(detectIntent("Как приготовить борщ?")).toBe("chat");
  });
});

describe("suggestName", () => {
  it("proposes a default so the user can just press continue", () => {
    expect(suggestName("сайт для кофейни", "custom")).toBe("Кофейни");
    expect(suggestName("", "shop")).toBe("Мой магазин");
    expect(suggestName("", "unknown")).toBe("Мой проект");
  });
});

describe("friendlyError", () => {
  it("never shows raw network jargon", () => {
    expect(friendlyError(new Error("Failed to fetch"))).toMatch(/интернет/i);
    expect(friendlyError(new Error("HTTP 429"))).toMatch(/перегружены/i);
    expect(friendlyError(new Error("OPENROUTER_API_KEY не задан"))).toMatch(/ключ/i);
  });
});

describe("presentation helpers", () => {
  it("reads the slide count from the sentence and clamps it", () => {
    expect(slideCountFrom("презентация про космос на 10 слайдов", 8)).toBe(10);
    expect(slideCountFrom("на 99 слайдов", 8)).toBe(20);
    expect(slideCountFrom("без числа", 8)).toBe(8);
  });
  it("chooses a theme from the topic", () => {
    expect(themeFor("про космос")).toBe("midnight");
    expect(themeFor("здоровое питание")).toBe("forest");
  });
});
