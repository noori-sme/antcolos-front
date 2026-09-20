import { describe, expect, it } from "vitest";
import {
  BIO_MAX_LENGTH, HEADLINE_MAX_LENGTH, remaining, validateBio, validateHeadline,
  validateLink, validateLocation,
} from "./fields";

describe("the fields a person writes", () => {
  it("accepts anything within the limit, including nothing", () => {
    expect(validateHeadline("")).toBeNull();
    expect(validateHeadline("Dispatcher · reefer, Midwest")).toBeNull();
    expect(validateBio("Ten years in produce lanes.")).toBeNull();
    expect(validateLocation("Chicago, IL")).toBeNull();
  });

  it("does not argue with a name written in another script", () => {
    expect(validateHeadline("配車担当 · 冷凍便")).toBeNull();
    expect(validateBio("Diez años en carriles de productos agrícolas.")).toBeNull();
  });

  it("refuses only what it could not store", () => {
    expect(validateHeadline("x".repeat(HEADLINE_MAX_LENGTH + 1))).toContain("120");
    expect(validateBio("x".repeat(BIO_MAX_LENGTH + 1))).toContain("600");
    expect(validateLocation("x".repeat(200))).toContain("80");
  });

  it("measures the trimmed value, so trailing spaces are not a rejection", () => {
    expect(validateHeadline(`${"x".repeat(HEADLINE_MAX_LENGTH)}      `)).toBeNull();
  });
});

describe("links on a public page", () => {
  it("accepts ordinary web links", () => {
    expect(validateLink("https://northlinefreight.example.com")).toBeNull();
    expect(validateLink("http://example.com/sam")).toBeNull();
  });

  it("refuses a scheme that would run as script on our own origin", () => {
    expect(validateLink("javascript:alert(1)")).toBe("Links have to start with https://");
    expect(validateLink("data:text/html,<script>alert(1)</script>"))
      .toBe("Links have to start with https://");
  });

  it("refuses something that is not a link at all", () => {
    expect(validateLink("northline dot com")).toContain("full link");
    expect(validateLink("   ")).toContain("remove the row");
  });
});

describe("the character counter", () => {
  it("counts down from the limit", () => {
    expect(remaining("abc", 10)).toBe(7);
    expect(remaining("  abc  ", 10)).toBe(7);
  });
});
