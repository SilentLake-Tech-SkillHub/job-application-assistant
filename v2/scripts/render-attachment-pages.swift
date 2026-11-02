import AppKit
import PDFKit
import Foundation
let args=CommandLine.arguments
guard args.count==3,let document=PDFDocument(url:URL(fileURLWithPath:args[1])),document.pageCount>0,document.pageCount<=40 else {throw NSError(domain:"PDF_SOURCE_REQUIRED",code:1)}
let directory=URL(fileURLWithPath:args[2]);try FileManager.default.createDirectory(at:directory,withIntermediateDirectories:true,attributes:[.posixPermissions:0o700])
for index in 0..<document.pageCount {
 guard let page=document.page(at:index) else {throw NSError(domain:"PDF_PAGE_MISSING",code:1)}
 let bounds=page.bounds(for:.cropBox),width:CGFloat=1200,height=1200*bounds.height/bounds.width
 let image=page.thumbnail(of:NSSize(width:width,height:height),for:.cropBox)
 guard let data=image.tiffRepresentation,let bitmap=NSBitmapImageRep(data:data),let png=bitmap.representation(using:.png,properties:[:]) else {throw NSError(domain:"PDF_RENDER_FAILED",code:1)}
 let target=directory.appendingPathComponent("page-\(index+1).png");try png.write(to:target);try FileManager.default.setAttributes([.posixPermissions:0o600],ofItemAtPath:target.path)
}
print("{\"pageCount\":\(document.pageCount)}")
