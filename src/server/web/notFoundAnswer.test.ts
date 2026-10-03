import { describe, expect, it } from "vitest";
import { notFoundAnswer } from "./notFoundAnswer.js";

describe("what the web answers for a path no route took", () => {
  it("gives the document only to an application path", () => {
    expect({
      route: notFoundAnswer("/projects/p1/sessions"),
      root: notFoundAnswer("/"),
      routeWithQuery: notFoundAnswer("/?project=p1&session=s1"),
      asset: notFoundAnswer("/assets/index-OLD.js"),
      assetWithQuery: notFoundAnswer("/assets/index-OLD.css?v=1"),
      api: notFoundAnswer("/api/no-such-route"),
      apiRoot: notFoundAnswer("/api"),
      machineApi: notFoundAnswer("/api/machines/local/no-such-route"),
      apiLookalike: notFoundAnswer("/apiary"),
      apiJson: notFoundAnswer("/api/thing.json"),
    }).toEqual({
      route: "document",
      root: "document",
      routeWithQuery: "document",
      asset: "missing-asset",
      assetWithQuery: "missing-asset",
      api: "missing-api",
      apiRoot: "missing-api",
      machineApi: "missing-api",
      apiLookalike: "document",
      apiJson: "missing-api",
    });
  });
});
