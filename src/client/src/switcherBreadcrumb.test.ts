import { describe, expect, it } from "vitest";
import { switcherBreadcrumb } from "./switcherBreadcrumb";

const soloMachine = { id: "local", name: "Local" };
const machines = [soloMachine, { id: "pi", name: "pi" }];
const projects = [{ id: "p1", name: "pi-web", path: "/repos/pi-web" }, { id: "p2", name: "repo", path: "/repos/repo" }];
const folders = [
  { id: "w1", label: "main", path: "/repos/pi-web", projectId: "p1" },
  { id: "w2", label: "probe", path: "/repos/pi-web-probe", projectId: "p1" },
  { id: "w3", label: "main", path: "/repos/repo", projectId: "p2" },
];

describe("switcherBreadcrumb", () => {
  it("omits the machine level when there is only one machine", () => {
    const segments = switcherBreadcrumb({ machines: [soloMachine], machineId: "local", projects, projectId: undefined, folders, folderPath: undefined });
    expect(segments.map((segment) => segment.level)).toEqual(["project"]);
  });

  it("names each level by what is chosen there", () => {
    const segments = switcherBreadcrumb({ machines, machineId: "pi", projects, projectId: "p1", folders, folderPath: "/repos/pi-web-probe" });
    expect(segments.map((segment) => [segment.level, segment.label])).toEqual([
      ["machine", "pi"],
      ["project", "pi-web"],
      ["folder", "probe"],
    ]);
    expect(segments.every((segment) => segment.chosen)).toBe(true);
  });

  it("says everything is in scope when nothing is chosen", () => {
    const segments = switcherBreadcrumb({ machines, machineId: "local", projects, projectId: undefined, folders, folderPath: undefined });
    expect(segments.map((segment) => segment.label)).toEqual(["Local", "All projects"]);
    expect(segments.find((segment) => segment.level === "project")?.chosen).toBe(false);
  });

  it("offers folders only inside the chosen project", () => {
    const segments = switcherBreadcrumb({ machines, machineId: "local", projects, projectId: "p1", folders, folderPath: undefined });
    const folderSegment = segments.find((segment) => segment.level === "folder");
    expect(folderSegment?.options.map((option) => option.label)).toEqual(["main", "probe"]);
    expect(folderSegment?.label).toBe("All folders");
  });

  it("drops the folder level when the chosen project has none", () => {
    const segments = switcherBreadcrumb({ machines, machineId: "local", projects, projectId: "p2", folders: [], folderPath: undefined });
    expect(segments.map((segment) => segment.level)).toEqual(["machine", "project"]);
  });

  it("marks the current option at every level", () => {
    const segments = switcherBreadcrumb({ machines, machineId: "pi", projects, projectId: "p1", folders, folderPath: "/repos/pi-web" });
    expect(segments.flatMap((segment) => segment.options.filter((option) => option.current).map((option) => option.label))).toEqual(["pi", "pi-web", "main"]);
  });
});
