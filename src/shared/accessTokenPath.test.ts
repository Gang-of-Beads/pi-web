import { describe, expect, it } from "vitest";
import { accessTokenBaseUrl, splitAccessTokenPath } from "./accessTokenPath";

describe("an access token in the path", () => {
  it("is split back out of every URL built under its base", () => {
    const token = "a/b+c=";
    const base = accessTokenBaseUrl("https://machine.example:8504/pi", token);
    const pathOf = (relative: string): string => { const url = new URL(relative, base); return `${url.pathname}${url.search}`.replace(/^\/pi/u, ""); };
    expect([pathOf("api/sessions?cwd=%2Fa"), pathOf(""), pathOf("pi-web-plugins/x/chunk.js")].map(splitAccessTokenPath)).toEqual([
      { url: "/api/sessions?cwd=%2Fa", token },
      { url: "/", token },
      { url: "/pi-web-plugins/x/chunk.js", token },
    ]);
  });

  it("leaves a URL without one alone, and a base without a token unprefixed", () => {
    expect(accessTokenBaseUrl("https://machine.example:8504", undefined)).toBe("https://machine.example:8504/");
    expect(["/api/sessions", "/access", "/access-token", "/access-token/%E0%A4%A/api"].map(splitAccessTokenPath)).toEqual([{ url: "/api/sessions" }, { url: "/access" }, { url: "/access-token" }, { url: "/access-token/%E0%A4%A/api" }]);
  });
});
