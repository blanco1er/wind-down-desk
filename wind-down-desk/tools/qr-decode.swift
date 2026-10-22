// Decodes QR codes in PNG files with macOS CoreImage (no network): prints "<file>\t<text>" per file.
//   swift tools/qr-decode.swift a.png b.png
import CoreImage
import Foundation

let detector = CIDetector(ofType: CIDetectorTypeQRCode, context: nil, options: [CIDetectorAccuracy: CIDetectorAccuracyHigh])!
for path in CommandLine.arguments.dropFirst() {
    guard let image = CIImage(contentsOf: URL(fileURLWithPath: path)) else {
        print("\(path)\t<unreadable>")
        continue
    }
    let text = detector.features(in: image).compactMap { ($0 as? CIQRCodeFeature)?.messageString }.first ?? "<none>"
    print("\(path)\t\(text)")
}
