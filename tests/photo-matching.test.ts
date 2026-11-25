import { describe, expect, it } from "vitest";
import { matchPhotos, normNumber, parsePhotoName, type MatchEntry, type MatchPhoto } from "@/lib/photos/match";
import { readPhotoMeta } from "@/lib/photos/jpeg-meta";

describe("file names", () => {
  it("HIKMICRO (owner's Generator convention)", () => {
    expect(parsePhotoName("HM_00051_DAR.jpg")).toEqual({ number: "51", role: "visual", convention: "hikmicro" });
    expect(parsePhotoName("HM_00051_IR.jpg")).toEqual({ number: "51", role: "ir", convention: "hikmicro" });
    expect(parsePhotoName("HM_00051.JPG")).toEqual({ number: "51", role: "ir", convention: "hikmicro" });
    expect(parsePhotoName("DCIM/100HIKMICRO/HM_00128_DAR.jpeg")).toEqual({ number: "128", role: "visual", convention: "hikmicro" });
  });
  it("other prefixes and plain numbers", () => {
    expect(parsePhotoName("IR_0110.jpg")).toMatchObject({ number: "110", role: "ir" });
    expect(parsePhotoName("FLIR0042.jpg")).toMatchObject({ number: "42", role: "ir" });
    expect(parsePhotoName("VIS_0042.jpg")).toMatchObject({ number: "42", role: "visual" });
    expect(parsePhotoName("DC_0042.JPG")).toMatchObject({ number: "42", role: "visual" });
    expect(parsePhotoName("Panel P4 visual 80.jpg")).toMatchObject({ number: "80", role: null }); // role unknown: reviewer decides
    expect(parsePhotoName("IMG_1234.HEIC", { radiometric: true, format: "heic" })).toMatchObject({ number: "1234", role: "ir" });
    expect(parsePhotoName("front of building.jpg")).toEqual({ number: null, role: null, convention: "none" });
  });
  it("leading zeros do not matter", () => {
    expect(normNumber("00051")).toBe("51");
    expect(normNumber("0110")).toBe("110");
    expect(normNumber("")).toBeNull();
  });
});

const entries: MatchEntry[] = [
  { resultId: "r1", imageId: "i1", label: "Panel L1", irNumber: "51", visualNumber: "51" },
  { resultId: "r2", imageId: "i2a", label: "Switchboard Top Half", irNumber: "54", visualNumber: "54" },
  { resultId: "r2", imageId: "i2b", label: "Switchboard Bottom Half", irNumber: "55", visualNumber: "57" },
  { resultId: "r3", imageId: "i3", label: "Panel P4", irNumber: "0080", visualNumber: "" },
  { resultId: "r4", imageId: "i4", label: "Disconnect 1", irNumber: "", visualNumber: "" },
  { resultId: "r5", imageId: "i5", label: "Panel X (typo)", irNumber: "61", visualNumber: "61" },
  { resultId: "r6", imageId: "i6", label: "Panel Y (typo)", irNumber: "61", visualNumber: "61" },
];
const photo = (id: string, name: string, sha = id, extra: Partial<MatchPhoto> = {}): MatchPhoto => ({ id, name, sha256: sha, ...parsePhotoName(name), ...extra });

describe("matching", () => {
  const photos = [
    photo("a", "HM_00051.jpg"), photo("b", "HM_00051_DAR.jpg"),
    photo("c", "HM_00054.jpg"), photo("d", "HM_00054_DAR.jpg"),
    photo("e", "HM_00055.jpg"), photo("f", "HM_00057_DAR.jpg"), // visual number overridden to 57
    photo("g", "HM_00080.jpg"), photo("h", "HM_00080_DAR.jpg"), // P4 visual follows IR (blank override)
    photo("dup", "HM_00051 (1).jpg", "a"), // same content as a
    photo("x1", "HM_00099.jpg"), // no entry recorded 99
    photo("x2", "notes.jpg"),
    photo("c2", "IR_0054.jpg"), // second file claiming IR 54 (another camera naming)
    photo("t", "HM_00061.jpg"), // number recorded on two entries
  ];
  const r = matchPhotos(entries, photos);
  const assigned = Object.fromEntries(r.assignments.map((a) => [a.photoId, `${a.imageId}:${a.role}`]));

  it("assigns IR and visual by recorded numbers, including multiple views of one item and overridden visual numbers", () => {
    expect(assigned).toEqual({ a: "i1:ir", b: "i1:visual", e: "i2b:ir", f: "i2b:visual", g: "i3:ir", h: "i3:visual", d: "i2a:visual" });
  });
  it("reports duplicates, conflicts, ambiguous numbers, unmatched files and missing photographs", () => {
    expect(r.duplicates).toEqual([{ photoId: "dup", sameAs: "a" }]);
    expect(r.conflicts).toEqual([{ role: "ir", number: "54", photoIds: ["c", "c2"] }]);
    expect(r.ambiguous).toEqual([{ role: "ir", number: "61", imageIds: ["i5", "i6"], photoIds: ["t"] }]);
    expect(r.unmatched.map((u) => u.photoId).sort()).toEqual(["x1", "x2"]);
    expect(r.unmatched.find((u) => u.photoId === "x1")!.reason).toMatch(/No entry recorded IR image number 99/);
    expect(r.missing.map((m) => `${m.imageId}:${m.role}`)).toEqual(["i2a:ir", "i5:ir", "i5:visual", "i6:ir", "i6:visual"]);
  });
  it("a reviewer's manual choice wins and stays; excluded files are ignored", () => {
    const r2 = matchPhotos(entries, [
      photo("c", "HM_00054.jpg", "c", { manual: { resultId: "r2", imageId: "i2a", role: "ir" } }),
      photo("c2", "IR_0054.jpg", "c2", { excluded: true }),
      photo("t", "HM_00061.jpg", "t", { manual: { resultId: "r6", imageId: "i6", role: "ir" } }),
    ]);
    expect(r2.assignments).toEqual([
      { photoId: "c", resultId: "r2", imageId: "i2a", role: "ir", source: "manual" },
      { photoId: "t", resultId: "r6", imageId: "i6", role: "ir", source: "manual" },
    ]);
    expect(r2.conflicts).toEqual([]);
  });
});

describe("JPEG metadata (read only)", () => {
  /** A minimal JPEG: SOI, APP1 Exif (Make, Model, DateTimeOriginal via ExifIFD), APP5 thermal block, SOF0, EOI. */
  function jpeg(): Uint8Array {
    const enc = new TextEncoder();
    const tiff: number[] = [0x49, 0x49, 0x2a, 0x00, 8, 0, 0, 0];
    const strings: [number, string][] = [[0x010f, "HIKMICRO\0"], [0x0110, "B20 Pro\0"]];
    const ifd0Count = strings.length + 1;
    const ifd0Size = 2 + ifd0Count * 12 + 4;
    let dataOff = 8 + ifd0Size;
    const entriesArr: number[] = [ifd0Count, 0];
    const data: number[] = [];
    for (const [tag, s] of strings) {
      const b = [...enc.encode(s)];
      entriesArr.push(tag & 0xff, tag >> 8, 2, 0, b.length, 0, 0, 0, dataOff & 0xff, dataOff >> 8, 0, 0);
      data.push(...b); dataOff += b.length;
    }
    const exifIfd = dataOff;
    entriesArr.push(0x69, 0x87, 4, 0, 1, 0, 0, 0, exifIfd & 0xff, exifIfd >> 8, 0, 0);
    entriesArr.push(0, 0, 0, 0);
    const dto = [...enc.encode("2026:11:09 10:15:30\0")];
    const exifEntries = [1, 0, 0x03, 0x90, 2, 0, dto.length, 0, 0, 0, (exifIfd + 18) & 0xff, (exifIfd + 18) >> 8, 0, 0, 0, 0, 0, 0];
    const body = [...[...enc.encode("Exif")], 0, 0, ...tiff, ...entriesArr, ...data, ...exifEntries, ...dto];
    const app1 = [0xff, 0xe1, (body.length + 2) >> 8, (body.length + 2) & 0xff, ...body];
    const thermal = new Array(20000).fill(7);
    const app5body = [...enc.encode("IRIMG\0"), ...thermal];
    const app5 = [0xff, 0xe5, (app5body.length + 2) >> 8, (app5body.length + 2) & 0xff, ...app5body];
    const sof = [0xff, 0xc0, 0, 11, 8, 0x01, 0xe0, 0x02, 0x80, 1, 1, 0x11, 0];
    return new Uint8Array([0xff, 0xd8, ...app1, ...app5, ...sof, 0xff, 0xd9]);
  }
  it("reads camera, time, size and the radiometric data block without changing anything", () => {
    const bytes = jpeg();
    const copy = bytes.slice();
    const m = readPhotoMeta(bytes);
    expect(m).toMatchObject({ format: "jpeg", make: "HIKMICRO", model: "B20 Pro", takenAt: "2026-11-09T10:15:30", width: 640, height: 480, radiometric: true });
    expect(m.segments!.map((s) => `APP${s.app}:${s.id}`)).toEqual(["APP1:Exif", "APP5:IRIMG"]);
    expect(bytes).toEqual(copy);
  });
  it("other formats", () => {
    expect(readPhotoMeta(new Uint8Array([0x89, 0x50, 0x4e, 0x47])).format).toBe("png");
    expect(readPhotoMeta(new Uint8Array([0, 1, 2, 3])).format).toBe("other");
  });
});
