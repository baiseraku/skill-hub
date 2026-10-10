#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
从原始 PDF 导出论文插图。

⚠️ 为什么不提取「嵌入图片」：出版排版里插图 = 位图（图形本身）+ 矢量文字层
（面板字母 A/B/C、坐标轴标注、聚类/样本编号、图例、通路名、基因名、统计标注）。
get_images() / pdfimages 这类做法只拿得到位图，图上所有文字会静默消失，只剩图形；
提高 JPEG 质量或渲染分辨率都救不回来，因为那些字根本不在位图数据里。

正确做法：按「整幅图区域」渲染页面，位图与矢量文字一起栅格化。
区域 = 位图 bbox ∪ 与之相交/紧邻上方的文字块，纵向截到图注之前。

用法:
  python extract_figures.py <原PDF> <输出目录> [--zoom 3.6] [--quality 88] [--pages 4:fig1,6:fig2,...]

不传 --pages 时按常见排版自动探测：每页只要有位图，就把该页当作图页导出。
"""
import fitz, os, re, sys, json

argv = sys.argv
if len(argv) < 3:
    print(__doc__)
    sys.exit(1)

pdf_path, out_dir = argv[1], argv[2]


def opt(name, default):
    return argv[argv.index(name) + 1] if name in argv else default


zoom = float(opt('--zoom', 3.6))
quality = int(opt('--quality', 88))
pages_opt = opt('--pages', None)

os.makedirs(out_dir, exist_ok=True)
doc = fitz.open(pdf_path)

# 图页 → 文件名：--pages 显式指定，否则自动探测含位图的页
if pages_opt:
    targets = []
    for part in pages_opt.split(','):
        pno, _, name = part.partition(':')
        targets.append((int(pno), name.strip() or f'fig{pno}'))
else:
    targets = []
    for i in range(doc.page_count):
        if doc[i].get_images(full=True):
            targets.append((i + 1, f'p{i+1:02d}_fig'))

# 正文栏宽：A4 减去左右各 17mm 页边（与 md-render 的 @page 一致）
COL_W_PT = 498.8

report = []
for pno, name in targets:
    page = doc[pno - 1]
    pwid, phei = page.rect.width, page.rect.height

    # 图注位置：以「Figure N.」开头的那一块的 y0 作为图区下界
    cap_y = phei - 40
    for x0, y0, x1, y1, txt, *_ in page.get_text('blocks'):
        if re.match(r'\s*(Figure|Fig\.?)\s*\d+[.:]', txt):
            cap_y = min(cap_y, y0)
            break

    imgs = page.get_images(full=True)
    if not imgs:
        print(f'  ⚠ p{pno} 无位图，跳过')
        continue
    imgbox = page.get_image_bbox(imgs[0])

    # 图区 = 位图 bbox ∪ 与之相交/紧邻外沿的文字块。
    # 面板字母可能画在正上方，也可能贴左/右外沿（实测 Neurogastroenterol Motil：
    # 字母 A/B/D/E/F 画在 bbox 左侧 2–8pt），漏了字会被裁掉、只剩图形。
    clip = fitz.Rect(imgbox)
    for x0, y0, x1, y1, txt, *_ in page.get_text('blocks'):
        r = fitz.Rect(x0, y0, x1, y1)
        intersects = r.intersects(imgbox)
        above = (y1 <= imgbox.y0 + 1 and y1 >= imgbox.y0 - 16
                 and x1 > imgbox.x0 and x0 < imgbox.x1)
        is_panel_letter = bool(re.fullmatch(r'[A-H]\.?', txt.strip()))
        side = (is_panel_letter
                and y1 > imgbox.y0 and y0 < imgbox.y1
                and ((imgbox.x0 - 16 <= x1 <= imgbox.x0 + 1)
                     or (imgbox.x1 - 1 <= x0 <= imgbox.x1 + 16)))
        if intersects or above or side:
            clip |= r
    clip = fitz.Rect(clip.x0 - 2, min(clip.y0, imgbox.y0) - 2,
                     clip.x1 + 2, min(clip.y1, cap_y - 3))

    pix = page.get_pixmap(matrix=fitz.Matrix(zoom, zoom), clip=clip, alpha=False)
    out = os.path.join(out_dir, name + '.jpg')
    pix.save(out, jpg_quality=quality)
    report.append(dict(page=pno, name=name, clip=[round(v, 1) for v in clip],
                       px=f'{pix.width}x{pix.height}',
                       aspect=round(clip.width / clip.height, 4),
                       kb=round(os.path.getsize(out) / 1024)))
    print(f'  p{pno:02d} {name:22s} {pix.width}x{pix.height}px '
          f'{os.path.getsize(out)/1024:6.0f}KB  图区 {clip.width:.0f}x{clip.height:.0f}pt')

print(f'\n共导出 {len(report)} 张 → {out_dir}')
print(f'有效分辨率 ≈ {zoom*72:.0f} DPI（图在 A4 正文栏宽 {COL_W_PT:.0f}pt 铺满时）')
with open(os.path.join(out_dir, '_figmeta.json'), 'w') as fh:
    json.dump(report, fh, ensure_ascii=False, indent=1)
print('提示：图区改动会改变宽高比，进而改变分页；若下游产 PDF，目录页码需重算。')
