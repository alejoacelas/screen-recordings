// Prints one JSON line per image: {"path":..., "lines":[[text, x, y, w, h], ...]} with top-left origin, 0-1 coordinates.
import Vision
import AppKit
for path in CommandLine.arguments.dropFirst() {
  guard let img = NSImage(contentsOfFile: path), let cg = img.cgImage(forProposedRect: nil, context: nil, hints: nil) else { continue }
  let req = VNRecognizeTextRequest(); req.recognitionLevel = .accurate; req.usesLanguageCorrection = false
  try? VNImageRequestHandler(cgImage: cg).perform([req])
  var lines: [[Any]] = []
  for o in req.results ?? [] {
    guard let s = o.topCandidates(1).first?.string else { continue }
    let b = o.boundingBox
    lines.append([s, b.minX, 1 - b.maxY, b.width, b.height])
  }
  let data = try! JSONSerialization.data(withJSONObject: ["path": path, "lines": lines])
  print(String(data: data, encoding: .utf8)!)
}
