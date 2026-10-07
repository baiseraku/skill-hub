---
name: seurat-qc-annotate
description: >-
  单细胞 RNA-seq 标准流水线（从已合并 Seurat 对象开始）：QC 指标重算 + 带分位数/参考线
  标注的 QC 小提琴图 → 手动逐样本阈值过滤 → 细胞周期评分 → Harmony 批次矫正、肘图定
  dims 与聚类 UMAP → FindAllMarkers + presto AUC / 供者 pseudobulk 双筛 marker →
  细胞类型注释。
whenToUse: >-
  已有合并好的 Seurat 对象（含 sample 分组、条码已加样本前缀），需要走「QC 过滤 →
  批次矫正聚类 → 细胞类型注释」流程时使用；也可只复用其中任一阶段（只用阶段 A 的
  QC 小提琴图规范亦可）。
when_to_use: >-
  已有合并好的 Seurat 对象（含 sample 分组、条码已加样本前缀），需要走「QC 过滤 →
  批次矫正聚类 → 细胞类型注释」流程时使用；也可只复用其中任一阶段（只用阶段 A 的
  QC 小提琴图规范亦可）。
metadata:
  version: 4.1.0
  source: 从 GSE206300 irColitis 项目 QC.R 整理（阶段 A–E，2025-09-10；含肘图定 dims 与 AUC+pseudobulk marker 双筛）
---

# Seurat 单细胞流水线：QC → 聚类 → 注释

把 GSE206300（irColitis 肠组织）项目 `QC.R` 提炼为可复用流程，覆盖**阶段 A–E**。
入口是**已合并好的 Seurat 对象**（读 10X、合并、元数据并入见 `import.R`，不在本流程内），
从最初 QC 小提琴图开始依次执行 A→E，每阶段核对输出无误再继续。
剔除坏群、重新聚类与复注释**不在本流程内**——该项目的 `QC.R` 止于阶段 E，后续另起脚本。

阶段 E 的 marker 筛选依赖 `presto`（算 AUC）与供者级 pseudobulk（counts 聚合后重算 FDR），
两者取交集才作为注释依据。

> **应用方式**：交付物是**按数据改好并写入项目 .R 脚本**的代码（沿用 QC.R 的分节与命名
> 习惯）——**可以不用运行 R**；运行与否由你决定（阈值、`cell_type_map` 常需先人工核对）。

⚠️ 本流程是模板，**不是拿来就能跑的现成脚本**：代码里标 `⚠️` 的位置、以及下面
【修改点速查】里的参数，都必须按你的数据、物种改过再跑。

**写法约定**（与项目的 `r-code-requirements` 一致，照此写）：

- 路径以字面量直接写在读入/导出调用处，不设 `work_dir` / `out_dir` / `in_file` 变量
- 参数就近定义在所在阶段、对应代码之前（`thr`、聚类参数、marker 阈值等），文件顶部不堆“参数区”
- 每个阶段自带 `library()`，保证该阶段可独立运行；拼成整链单脚本时重复加载无害
- 阶段代码块顶部保留一行 `# 输入：…`，说明该阶段依赖的对象或文件（跨脚本/独立运行时靠它续跑）

## 修改点速查（⚠️ 每次应用前逐条核对，标“必改”的不能跳过）

| 位置 | 改什么 | 说明 |
|---|---|---|
| 阶段 A `setwd` 与各处 `output/...` 路径 | **必改**：项目路径 | 路径按项目写死；`output` 目录由 `dir.create` 兜底 |
| 阶段 A `pattern = "^MT-"` | **按物种必改** | 人类 `^MT-`、小鼠 `^mt-`；写错则 `percent.mt` 全为 0 |
| 阶段 A `sample` 列判断 | 视输入而定 | 输入已有 `sample` 列则忽略；否则自动用 `orig.ident` |
| 阶段 A `sample_no` 编号 | 样本少可删 | 样本多时 x 轴用序号更紧凑，须与控制台打印的对照表对号 |
| 阶段 A 小提琴图 `width` / 刻度间隔 | 按样本数与量级调 | 见下方《QC 小提琴图统一要求》 |
| 阶段 B `thr` | **必改**：逐样本阈值 | 行数 = 你的样本数，看阶段 A 的图填；`Inf` = 该方向不限 |
| 阶段 B `max_mt` | 按数据调 | 全样本同值就写标量（R 自动回收），不同值写等长向量 |
| 阶段 C `cc.genes` | **按物种必改** | 它是人类基因符号；小鼠须 `str_to_title()` 转换后再传入 |
| 阶段 D `n_hvg` / `n_pcs` | 可选调整 | HVG 数与 PCA 维数；`n_pcs` 必须 ≥ 肘图选定的 dims |
| 阶段 D `dims_use` | **按肘图定** | 看 `PC_elbow.pdf` 拐点；本项目取 `1:15`（膝在 5–7、长尾缓降，不宜截太早） |
| 阶段 D `resolution` | 可选调整 | 聚类粒度，与 dims 相互独立；本项目 0.5 |
| 阶段 D `theta` / `lambda` / `sigma` / `max_iter` | 可选调整 | ⚠️ harmony 2.x 参数名与默认值已变，见《Harmony 调参速查》 |
| 阶段 E `marker_auc` / `marker_fdr` / `min_donors` / `min_cells_pb` | **按数据必改** | 供者列 `patient.id` 也要按元数据改；`min_donors` 专门拦单供者簇 |
| 阶段 E `cell_type_map` | **必改**：每个 cluster 的类型 | 按 `markers_auc_pb.csv` 人工核对后填全；存疑群标 `"Remove"` 留给后续脚本剔除 |
| 阶段 E `min.pct` / `logfc.threshold` | 可选调整 | FindAllMarkers 的 marker 筛选严格度 |
| 阶段 E `JoinLayers` | 按 Seurat 版本 | 仅 v5 多 layer 需要；v4 或已合并 layer 的对象注释掉 |
| 各阶段输出文件名 | 可选自定义 | 不要覆盖已有项目的输出 |

## 阶段 A：加载对象，输出最初 QC 小提琴图

```r
# 输入：output/import.rds（前序合并对象，34 样本，须含 sample 列）
setwd("/Volumes/Tiplus/R/Project/260903-1")   # ⚠️ 改成你的项目路径

rm(list = ls())
gc()

library(Seurat)
library(harmony)
library(ggplot2)   # Seurat 只 import 不 attach，下方 geom_* 需显式加载

# 读取合并对象
seurat <- readRDS("output/import.rds")
# Seurat v5 访问不存在的列会直接报错（v4 才返回 NULL），故不用 is.null 探测
if (!"sample" %in% colnames(seurat@meta.data)) seurat$sample <- seurat$orig.ident

# 样本序号（样本数量少则无需编号）
sample_levels <- sort(unique(seurat$sample))
seurat$sample_no <- match(seurat$sample, sample_levels)

# QC 指标
if (length(Layers(seurat, assay = "RNA")) > 1) seurat <- JoinLayers(seurat)
cnts <- GetAssayData(seurat, assay = "RNA", layer = "counts")
seurat$nCount_RNA   <- Matrix::colSums(cnts)
seurat$nFeature_RNA <- Matrix::colSums(cnts > 0)
# 物种线粒体前缀：人类 ^MT- / 小鼠 ^mt-
seurat[["percent.mt"]] <- PercentageFeatureSet(seurat, pattern = "^MT-")

# 保存合并后的原始对象
dir.create("output", showWarnings = FALSE)
saveRDS(seurat, file = "output/seurat_raw.rds")

# 概要输出
cat("\n==== 合并对象概要 ====\n"); print(seurat)
cat("\n==== 各样本细胞数 ====\n"); print(table(seurat$sample))
cat("\n==== 样本序号对照 ====\n")
print(data.frame(sample_no = seq_along(sample_levels), sample = sample_levels))
cat("\n==== 各样本 QC 指标中位数（UMI / 基因数 / 线粒体%） ====\n")
print(aggregate(cbind(nCount_RNA, nFeature_RNA, percent.mt) ~ sample,
                data = seurat@meta.data, FUN = median))

# 最初 QC 指标小提琴图
feat_q <- do.call(rbind, lapply(split(seurat$nFeature_RNA, seurat$sample_no), function(x) {
  data.frame(q95 = unname(quantile(x, 0.95)), q99 = unname(quantile(x, 0.99)))
}))
feat_q$sample_no <- as.numeric(rownames(feat_q))
feat_max <- max(seurat$nFeature_RNA)   # p_qc[[2]] 的主/次刻度序列共用

p_qc <- VlnPlot(seurat,
                features = c("nCount_RNA", "nFeature_RNA", "percent.mt"),
                group.by = "sample_no", pt.size = 0, ncol = 3, combine = FALSE)
p_qc[[2]] <- p_qc[[2]] +
  geom_segment(data = feat_q, aes(x = sample_no - 0.25, xend = sample_no + 0.25,
                                  y = q95, yend = q95),
               color = "steelblue", linewidth = 0.6, inherit.aes = FALSE) +
  geom_segment(data = feat_q, aes(x = sample_no - 0.25, xend = sample_no + 0.25,
                                  y = q99, yend = q99),
               color = "firebrick", linewidth = 0.6, inherit.aes = FALSE) +
  geom_text(data = feat_q, aes(x = sample_no, y = q99,
                               label = sprintf("95:%d\n99:%d", round(q95), round(q99))),
            vjust = -0.15, size = 2, lineheight = 0.9, color = "grey15",
            inherit.aes = FALSE) +
  scale_y_continuous(breaks = seq(0, feat_max, by = 500),
                     minor_breaks = seq(0, feat_max, by = 100)) +
  theme(panel.grid.major.y = element_line(linetype = "dashed", color = "grey65",
                                          linewidth = 0.25),
        panel.grid.minor.y = element_line(linetype = "dashed", color = "grey90",
                                          linewidth = 0.25))

p_qc[[3]] <- p_qc[[3]] + scale_y_continuous(breaks = seq(0, 100, by = 5))
p_qc[[3]]$layers <- c(list(geom_hline(yintercept = c(10, 15, 20, 25), linetype = "dashed",
                                      color = "grey65", linewidth = 0.25, inherit.aes = FALSE)),
                      p_qc[[3]]$layers)

p_qc <- lapply(p_qc, function(p) p + theme(legend.position = "none"))

pdf("output/QC_violin_raw.pdf", width = 50, height = 10)
print(patchwork::wrap_plots(p_qc, ncol = 3))
dev.off()
```

### QC 小提琴图统一要求

源自本项目 `output/QC_violin_raw_提示词.md`（整理自 `QC_violin_raw` 那张图）；改图时
同步改 `QC.R` 阶段 A 的那一段，别只改图不改脚本。

**适用场景**

- 输入是一个 Seurat 对象，图上是 nCount_RNA / nFeature_RNA / percent.mt 三个指标的分布
- 图的作用是让人逐样本读出该卡在哪：nFeature_RNA 面板定 `min_feat` / `max_feat`，
  percent.mt 面板定 `max_mt`，nCount_RNA 面板定 `min_count` / `max_count`
- 只给这张原始（未过滤）图加标注，过滤后重画的那张不加

**出图前提**

- 三个指标按当前数据重算，不用对象里的旧值：`JoinLayers` 合并 layer 后，`nCount_RNA` /
  `nFeature_RNA` 用 `Matrix::colSums` 从 counts 算，`percent.mt` 用 `PercentageFeatureSet`
  （前缀随物种，人 `^MT-`、鼠 `^mt-`）
- x 轴用样本序号：按样本名排序编号，同时在控制台打印「序号 ↔ 样本名」对照表

**图形框架**

- `VlnPlot(..., group.by = "sample_no", pt.size = 0, ncol = 3, combine = FALSE)`
- `combine = FALSE` 先拿到三个 ggplot 对象逐个改，最后 `patchwork::wrap_plots(p_qc, ncol = 3)` 拼回一页
- 三个面板统一 `theme(legend.position = "none")`：图注省掉，靠 x 轴序号和上面的对照表对号
- 单页 PDF，长宽按当前样本数定：样本多就往宽里加，加到 x 轴序号和数值标签不挤为止；高度 10 英寸左右够用

**nCount_RNA 面板**：跟随框架设置，不做额外修改。

**nFeature_RNA 面板**

- 分位数逐样本各算各的，只取上分位 `quantile(x, c(0.95, 0.99))`：双细胞、多细胞核看的是高值端
- 琴身上画两条横线，横跨琴身宽度（`x ± 0.25`）：p95 用 `steelblue`、p99 用 `firebrick`，`linewidth = 0.6`
- 数值浮在 p99 线上方，两行文本 `95:<整数>` / `99:<整数>`，`size = 2`（单位毫米）、`lineheight = 0.9`、`grey15`、`vjust = -0.15`
- y 轴主刻度每 500，范围从 0 到该列最大值；次刻度每 100
- 背景只画横向虚线，`linewidth = 0.25`：每 500 用 `grey65`，每 100 用 `grey90`，靠深浅区分两级

**percent.mt 面板**

- y 轴主刻度每 5，覆盖 0–100
- 在 10 / 15 / 20 / 25 画四条 `dashed` 参考线（`max_mt` 的候选阈值），`grey65`、`linewidth = 0.25`
- 这四条线要压在小提琴身下面

**容易踩的坑**

- `geom_segment` / `geom_text` 必须加 `inherit.aes = FALSE`：VlnPlot 的全局映射里有 `ident` 列，自定义的分位表没有这列，继承会直接报错
- VlnPlot 用 `theme_cowplot()`，本身没有网格线，背景虚线要靠 `panel.grid.major.y` / `panel.grid.minor.y` 显式打开；带 `.y` 的写法同时避免 x 轴每个样本多出一条竖线
- 与主刻度位置重合的次刻度会被 ggplot 丢掉。percent.mt 的 10 / 15 / 20 / 25 正好落在每 5 的主刻度上，用 `minor_breaks` 画不出任何线，只能走 `geom_hline` 图层
- 图层默认后加的压在先加的上面。要让参考线当背景，得把这一层插到 `layers` 列表最前
- `scale_y_continuous` 会替换 VlnPlot 自带的 `ylim`，控制台出现 `Scale for y is already present` 属正常
- `quantile()` 的返回值带 `"95%"` 名字，直接进 `data.frame` 会把行名带歪，用 `unname` 去掉
- `geom_text` 的 `size` 单位是毫米（`size = 2` 约合 5.7 pt），是页面上的绝对尺寸：页面加宽后单个样本占的横向空间变窄，标签反而更容易打架，改页面长宽时顺手复核一遍标签宽度

**验收**

- 每个样本各两条分位线、两行数值；数值等于 `round(quantile(该样本 nFeature_RNA, c(.95, .99)))`
- 分位线颜色与半宽（±0.25）正确，标签不重叠、不被面板边界裁掉
- nFeature_RNA 面板 y 轴刻度 0、500、1000 … 到不超过最大值；percent.mt 面板 0、5、10 … 100
- 背景只有横向虚线；percent.mt 的四条参考线在小提琴身之下
- 三个面板都没有图注
- 出图后渲染成位图逐面板核对：`sips -s format png` 转 PNG，再裁出面板放大看细节

## 阶段 B：手动阈值过滤

```r
# 输入：阶段 A 的对象 seurat / output/seurat_raw.rds
library(Seurat)

# 手动阈值：⚠️ 必改——行数 = 你的样本数，每个样本一列值，先看阶段 A 的
#      nFeature_RNA / percent.mt 面板再逐样本填；Inf = 该方向不限
thr <- data.frame(
  sample    = sort(unique(seurat$sample)),
  min_count = Inf,
  max_count = Inf,
  min_feat  = c(200, 200, 200, 200, 200, 200, 200, 200, 200, 200,        # 1–10
                200, 200, 200, 200, 200, 200, 200, 200, 100, 200,        # 11–20
                100, 200, 200, 200, 100, 200, 200, 200, 200, 200,        # 21–30
                200, 200, 200, 200),                                     # 31–34
  max_feat  = c(500, 1000, 1300, 1000, 1000, 500, 100, 100, 1500, 1700,   # 1–10
                1900, 1500, 1600, 600, 1400, 1500, 1000, 2200, 200, 1600, # 11–20
                300, 1300, 1000, 1400, 300, 1200, 200, 900, 1500, 4200,   # 21–30
                1000, 700, 1200, 2400),                                   # 31–34
  max_mt    = 15
)

# 手动阈值过滤函数 ----
qc_manual <- function(seurat, thr) {
  stopifnot(all(unique(seurat$sample) %in% thr$sample))
  meta <- seurat@meta.data
  ti <- match(meta$sample, thr$sample)   # 每个细胞对应的阈值行
  n <- meta$nCount_RNA
  f <- meta$nFeature_RNA
  m <- meta$percent.mt
  (is.infinite(thr$min_count[ti]) | n >= thr$min_count[ti]) &
    (is.infinite(thr$max_count[ti]) | n <= thr$max_count[ti]) &
    (is.infinite(thr$min_feat[ti])  | f >= thr$min_feat[ti]) &
    (is.infinite(thr$max_feat[ti])  | f <= thr$max_feat[ti]) &
    (is.infinite(thr$max_mt[ti])    | m <= thr$max_mt[ti])
}

keep_vec <- qc_manual(seurat, thr)
seurat_filtered <- subset(seurat, cells = colnames(seurat)[keep_vec])
saveRDS(seurat_filtered, file = "output/seurat_filtered.rds")

# 过滤前后各样本细胞数
cat("\n==== 手动阈值过滤前后细胞数 ====\n")
before <- table(seurat$sample)
after  <- table(factor(seurat_filtered$sample, levels = names(before)))
print(cbind(before = before, after = after))

# QC 指标小提琴图
pdf("output/QC_violin_filtered.pdf", width = 16, height = 5)
print(VlnPlot(seurat_filtered,
              features = c("nCount_RNA", "nFeature_RNA", "percent.mt"),
              group.by = "sample_no", pt.size = 0, ncol = 3))
dev.off()

# 释放阶段 A 的原始大对象
rm(seurat); gc()
```

## 阶段 C：细胞周期评分

```r
# 输入：阶段 B 的对象 seurat_filtered / output/seurat_filtered.rds
library(Seurat)

seurat_filtered <- NormalizeData(seurat_filtered, normalization.method = "LogNormalize")
# ⚠️ cc.genes 是人类基因符号；小鼠数据须改成首字母大写（str_to_title）
seurat_filtered <- CellCycleScoring(seurat_filtered,
                                    s.features = cc.genes$s.genes,
                                    g2m.features = cc.genes$g2m.genes)
saveRDS(seurat_filtered, file = "output/seurat_filtered_cc.rds")

# 各时期细胞数（G1 / S / G2M）
cat("\n==== 细胞周期时期 ====\n"); print(table(seurat_filtered$Phase))

# 分数分布（x 轴为样本序号，与 QC 图一致）
pdf("output/QC_violin_cellcycle.pdf", width = 16, height = 5)
print(VlnPlot(seurat_filtered, features = c("S.Score", "G2M.Score"),
              group.by = "sample_no", pt.size = 0, ncol = 2))
dev.off()
```

## 阶段 D：归一化 / 批次矫正 / 聚类

```r
# 输入：阶段 C 的对象 seurat_filtered / output/seurat_filtered_cc.rds
library(Seurat)
library(harmony)

# 聚类参数（dims_use 按下方肘图定，本项目取 1:15）
n_hvg <- 2000; n_pcs <- 30; dims_use <- 1:15; resolution <- 0.5

# 归一化 + 标准化
seurat_filtered <- NormalizeData(seurat_filtered, normalization.method = "LogNormalize")
seurat_filtered <- FindVariableFeatures(seurat_filtered, selection.method = "vst", nfeatures = n_hvg)
seurat_filtered <- ScaleData(seurat_filtered, features = VariableFeatures(seurat_filtered))
saveRDS(seurat_filtered, file = "output/seurat_filtered_norm.rds")

# 批次效应矫正
# ⚠️ 批次变量默认 sample；欠/过矫正调 theta / lambda，见下方《Harmony 调参速查》
# 种子放 RunPCA 前：PCA（irlba）是整链第一个随机步骤，保证重跑 cluster 编号稳定
set.seed(42)
seurat_filtered <- RunPCA(seurat_filtered, npcs = n_pcs, features = VariableFeatures(seurat_filtered), verbose = FALSE)
seurat_filtered <- RunHarmony(seurat_filtered, group.by.vars = "sample",
                              plot_convergence = TRUE, verbose = FALSE)
saveRDS(seurat_filtered, file = "output/seurat_filtered_harmony.rds")

# 肘图定 dims
# 在 pca 上读数（harmony 不改变维数，读数直接用于 dims_use）：标准差由陡降转平处即候选
# ⚠️ 候选超过 n_pcs 时，先把 n_pcs 调大并重跑上面的 RunPCA / RunHarmony 再往下走
pc_sd <- Stdev(seurat_filtered, reduction = "pca")
pdf("output/PC_elbow.pdf", width = 6, height = 5)
print(ElbowPlot(seurat_filtered, ndims = n_pcs))
dev.off()
# 佐读：主成分标准差及其相邻降幅，降幅明显变小处即拐点
print(data.frame(dim = seq_along(pc_sd), stdev = round(pc_sd, 2),
                 drop = round(c(NA, diff(pc_sd)), 2)))

# 降维 + 聚类
seurat_filtered <- FindNeighbors(seurat_filtered, reduction = "harmony", dims = dims_use)
seurat_filtered <- FindClusters(seurat_filtered, resolution = resolution)
seurat_filtered <- RunUMAP(seurat_filtered, reduction = "harmony", dims = dims_use)
saveRDS(seurat_filtered, file = "output/seurat_filtered_clustered.rds")  # 阶段 E 输入

# 聚类结果可视化
pdf("output/UMAP_clusters.pdf", width = 6, height = 5)
print(DimPlot(seurat_filtered, reduction = "umap", label = TRUE))
dev.off()
pdf("output/UMAP_by_sample.pdf", width = 16, height = 5)
print(DimPlot(seurat_filtered, reduction = "umap", group.by = "sample"))
dev.off()
```

### Harmony 调参速查（可选：仅当 UMAP 混合/分群不理想时用）

Harmony 没有“对错”标准，只在**欠矫正 ↔ 过矫正**之间取平衡；判断 = 可视化 + 定量指标 +
生物学 sanity check 三者结合。实务 90% 只需动 `theta` / `lambda`，其余保持默认。

⚠️ 参数名与默认值随版本变：下表按本机 harmony **2.0.5** 的 `RunHarmony` 实参写，
1.x 的 `theta` 默认 2、`lambda` 默认 1、迭代上限叫 `max.iter.harmony`（默认 10）；
2.x 把这三个透传给引擎、迭代上限改名 `max_iter`。调参前先 `?RunHarmony` 确认当前版本。

| 参数 | 默认（harmony 2.0.5） | 调大 → | 调小 → |
|---|---|---|---|
| `theta` | `NULL`（引擎自适应；1.x 为 2） | 批次混合更激进（欠矫正时调） | 更保守（过矫正时调） |
| `lambda` | `NULL`（1.x 为 1） | 矫正更保守、贴近原始 PCA | 矫正更激进 |
| `sigma` | 0.1 | 软聚类带宽更大、簇更平滑 | 簇更细、罕见群更易被单独拆出 |
| `max_iter` | 未设（1.x 为 `max.iter.harmony = 10`） | 收敛曲线不平时加到 20–30 | — |
| `npcs` | 50（本流程 30） | 保留更多结构供矫正 | — |

流程：

1. **收敛诊断**：阶段 D 首次运行已带 `plot_convergence = TRUE`，收敛曲线随跑随出；10 轮内
   不走平 → 只加迭代上限（2.x `max_iter` / 1.x `max.iter.harmony`）——这是迭代次数问题，
   不是矫正强度问题，别动其他参数。
2. **三张 UMAP 判欠矫/过矫**（前两张互相矛盾是正常的）：
   - 按 `sample` 着色：各样本应交叉混合；
   - 按疾病/分组（如 case/control）着色：组间应仍然分开可辨；
   - 按 `patient` 着色：同一病人的细胞应部分靠近。
3. **对症调参**：
   - 欠矫正（样本仍各自抱团、某 cluster 几乎由单一样本构成）→ `theta = 5`
     （单批次变量给标量；多批次变量给与 `group.by.vars` 等长的向量）；
   - 过矫正（组间被强行揉到一起、罕见群如浆细胞消失或被并进大类）→ `theta` 回 1–2、
     `lambda = 2–5`。**过矫正比欠矫正更危险**：它静默删除真实生物学信号。
   - ⚠️ 任何 Harmony 参数变更后，聚类结果必然改变：阶段 E 的 `cell_type_map` 作废，需
     按 `markers_auc_pb.csv` 重新核对（回退点是阶段 D 的 FindNeighbors，不是阶段 E）。
4. **定量复核（可选但推荐）**：UMAP 目测会被视觉混合放大，可用 lisi 包的
   iLISI（越高批次混合越好）/ cLISI（越低细胞类型保持越好），调参前后各算一次对比；
   简化替代：每 cluster 样本组成 Shannon 熵（混合度）+ 已知 marker（T 细胞 CD3D、
   B 细胞 MS4A1、髓系 LST1 等）矫正前后是否保持清晰分群。

```r
# 事后重看收敛曲线：对副本跑，看完即弃（R copy-on-modify，原对象不受影响）
# ⚠️ 勿写 seurat_filtered <- RunHarmony(seurat_filtered, ..., plot_convergence = TRUE)
#    那会覆盖已矫正的 harmony reduction
seu_diag <- seurat_filtered
seu_diag <- RunHarmony(seu_diag, group.by.vars = "sample",
                       plot_convergence = TRUE, verbose = FALSE)
rm(seu_diag)

# ⚠️ 调参确认后：从 RunHarmony 起整条链重跑，缺任一步都会新旧 embedding 混用
set.seed(42)   # Harmony 内部有随机初始化，种子放其前保证重跑可重复
seurat_filtered <- RunHarmony(seurat_filtered, group.by.vars = "sample",
                              theta = 5, verbose = FALSE)   # ⚠️ 填你定下的参数
seurat_filtered <- FindNeighbors(seurat_filtered, reduction = "harmony", dims = dims_use)
seurat_filtered <- FindClusters(seurat_filtered, resolution = resolution)
seurat_filtered <- RunUMAP(seurat_filtered, reduction = "harmony", dims = dims_use)
saveRDS(seurat_filtered, file = "output/seurat_filtered_clustered.rds")
```

## 阶段 E：差异基因 + 细胞类型注释

```r
# 输入：output/seurat_filtered_clustered.rds（独立运行时先执行
#       seurat_filtered <- readRDS("output/seurat_filtered_clustered.rds")）
library(Seurat)
library(dplyr)

seurat_filtered <- readRDS("output/seurat_filtered_clustered.rds")
Idents(seurat_filtered) <- "seurat_clusters"
# ⚠️ 仅 Seurat v5 多 layer 需要 JoinLayers；v4 或已合并 layer 的对象注释掉此行
seurat_filtered <- JoinLayers(seurat_filtered)

# 每群差异基因
# ⚠️ min.pct / logfc.threshold 可按需调整筛选严格度
all_markers <- FindAllMarkers(seurat_filtered, only.pos = TRUE,
                              min.pct = 0.25, logfc.threshold = 0.25)

# 每群按 avg_log2FC 取前 30
top30 <- all_markers %>%
  group_by(cluster) %>%
  slice_max(order_by = avg_log2FC, n = 30)
write.csv(top30, file = "output/markers_top30.csv", row.names = FALSE)
cat("已导出", nrow(top30), "行（每群前 30 个差异基因）\n")

# 每群 marker 双筛：单细胞 AUC + 供者 pseudobulk FDR
# ⚠️ 供者列按元数据改（本项目 patient.id）；min_donors / min_cells_pb 按数据调
marker_auc <- 0.7; marker_fdr <- 0.05; min_donors <- 3; min_cells_pb <- 10

# 单细胞层面：每个基因区分该簇与其他细胞的 AUC（presto 默认用归一化后的 data 层，padj 为簇内 BH）
auc_sc <- presto::wilcoxauc(seurat_filtered, group_by = "seurat_clusters")

# 供者层面：counts 按 供者 × 簇 求和成 pseudobulk，再转 log2 CPM
# 不用 AggregateExpression：它把列名里的 _ 换成 -，按列名反解供者/簇会错位
cnts <- GetAssayData(seurat_filtered, assay = "RNA", layer = "counts")
pb_key <- factor(paste(seurat_filtered$patient.id, seurat_filtered$seurat_clusters, sep = "__"))
pb <- as.matrix(cnts %*% Matrix::sparseMatrix(i = seq_along(pb_key), j = as.integer(pb_key), x = 1,
                                              dims = c(length(pb_key), nlevels(pb_key))))
colnames(pb) <- levels(pb_key)
pb_n <- table(pb_key)                        # 每个 pseudobulk 样本的细胞数
pb <- pb[, pb_n >= min_cells_pb, drop = FALSE]   # 细胞太少的 pseudobulk 噪声大，先剔除
pb_cpm <- log2(t(t(pb) / colSums(pb) * 1e6) + 1)
pb_cluster <- sub("^.*__", "", colnames(pb))

# pseudobulk 层面同一套检验（该簇 vs 其余，非配对；要控供者配对可改配对检验或 edgeR / limma）
auc_pb <- presto::wilcoxauc(pb_cpm, y = pb_cluster)

# 双条件交集：AUC ≥ marker_auc 且 pseudobulk FDR < marker_fdr
markers <- merge(
  auc_sc[auc_sc$auc >= marker_auc, c("feature", "group", "auc", "logFC", "padj", "pct_in", "pct_out")],
  auc_pb[auc_pb$padj < marker_fdr, c("feature", "group", "padj")],
  by = c("feature", "group"), suffixes = c("_sc", "_pb"))
markers$n_donor <- as.integer(table(pb_cluster)[markers$group])
markers <- markers[markers$n_donor >= min_donors, ]
markers <- markers[order(markers$group, -markers$auc), ]
write.csv(markers, file = "output/markers_auc_pb.csv", row.names = FALSE)

# 每簇 marker 数与供者数（供者少的簇 marker 不可靠，注释时降权）
cat("\n==== 各簇 marker 数与供者数 ====\n")
print(data.frame(cluster = names(table(pb_cluster)), n_donor = as.integer(table(pb_cluster)),
                 n_marker = as.integer(table(factor(markers$group, levels = names(table(pb_cluster)))))))

# 对照表注释细胞类型：按 markers_auc_pb.csv 逐簇核对 marker 后填写
# 本项目另存了一份 output/cluster_annotation_ircolitis.csv（细胞类型 / lineage / 证据），
#   lineage 列可直接映射过来
# ⚠️⚠️ 必改：每个 cluster 必须填一行；改 dims / resolution / Harmony 参数后 cluster 编号会变，须重填
cell_type_map <- c(
  "0"  = "Epithelial",        # 结肠上皮（低信息量，线粒体/核糖体基因主导）
  "6"  = "Immune T",          # T 细胞（常驻型）
  # ... 按 markers_auc_pb.csv 补全所有 cluster，要剔除的群标 "Remove"
)
if (length(cell_type_map) > 0) {
  seurat_filtered$cell_type <- unname(cell_type_map[as.character(seurat_filtered$seurat_clusters)])
}
# 防呆：cluster 未填全时停下，避免带 NA 注释继续跑（v5 下不存在列会报错，不用 is.null 探测）
if (!"cell_type" %in% colnames(seurat_filtered@meta.data) ||
    anyNA(seurat_filtered$cell_type))
  stop("cell_type_map 未覆盖全部 cluster，按 markers_auc_pb.csv 补全后再继续")
Idents(seurat_filtered) <- "cell_type"

# UMAP 按细胞类型着色
ct_levels <- levels(factor(seurat_filtered$cell_type))
ct_cols <- setNames(scales::hue_pal()(length(ct_levels)), ct_levels)
pdf("output/UMAP_cell_type.pdf", width = 8, height = 6)
print(DimPlot(seurat_filtered, group.by = "cell_type", cols = ct_cols,
              label = TRUE, repel = TRUE))
dev.off()

# 保存注释后的对象
saveRDS(seurat_filtered, file = "output/seurat_filtered_annotated.rds")
```

## 输出文件清单

| 文件 | 内容 | 阶段 |
|---|---|---|
| `seurat_raw.rds` + `QC_violin_raw.pdf` | 合并后原始对象（含 percent.mt）与带分位数标注的**最初 QC 小提琴图** | A |
| `seurat_filtered.rds` + `QC_violin_filtered.pdf` | 手动阈值过滤后对象与图 | B |
| `seurat_filtered_cc.rds` + `QC_violin_cellcycle.pdf` | 细胞周期评分后对象（Phase / S.Score / G2M.Score）与分数分布 | C |
| `seurat_filtered_norm.rds` / `seurat_filtered_harmony.rds` | 归一化 / Harmony 矫正后对象 | D |
| `PC_elbow.pdf` | 主成分标准差肘图（定 `dims_use` 的依据） | D |
| `seurat_filtered_clustered.rds` + `UMAP_clusters.pdf` + `UMAP_by_sample.pdf` | 聚类对象（阶段 E 输入）与两张 UMAP | D |
| `markers_top30.csv` | 每群 top30 差异基因（`FindAllMarkers`，辅助参考） | E |
| `markers_auc_pb.csv` | **注释依据**：单细胞 AUC ≥ 0.7 且供者 pseudobulk FDR < 0.05 的每簇 marker | E |
| `seurat_filtered_annotated.rds` + `UMAP_cell_type.pdf` | **最终对象**（注释完成）与细胞类型 UMAP | E |

## 注意点与常见问题

1. **Seurat v5 的列探测**：v5 访问不存在的 meta.data 列会直接报错（v4 才返回 `NULL`），
   所以判断列是否存在一律用 `!"sample" %in% colnames(seurat@meta.data)`，
   `cell_type` 的防呆同理；`is.null(seurat$xxx)` 在 v5 下不可靠。
2. **Seurat v5 多 layer**：merge 后跑 `FindAllMarkers` / `CellCycleScoring` 前需要
   `JoinLayers`（v4 不需要，⚠️ 按版本决定是否保留该行）；内存吃紧时也可提前合并 counts。
3. **阈值过滤**：`thr` 必须覆盖当前对象所有 sample，否则 `qc_manual` 会 stop；`Inf` = 不限。
   过滤前后细胞数用 `factor(..., levels = names(before))` 固定水平——某样本被滤空时
   两个 `table` 长度不一致，`cbind` 会按位置回收造成**静默错位**。
4. **细胞周期评分**：必须先 `NormalizeData` 再 `CellCycleScoring`；评分结果写在
   `Phase` / `S.Score` / `G2M.Score` 三列，`table(Phase)` 可在控制台核对；
   `cc.genes` 是人类基因符号，⚠️ 小鼠数据要 `str_to_title()` 转换。
5. **随机性**：`set.seed(42)` 必须在 `RunPCA` 之前（PCA 用 irlba 随机 SVD，是整链第一个
   随机步骤），否则重跑后 cluster 编号漂移，阶段 E 的 `cell_type_map` 会对不上号；
   `RunUMAP` 自带 `seed.use = 42`，无需额外处理。
6. **内存**：大对象用完即放——阶段 B 末尾 `rm(seurat); gc()` 释放原始对象；中途跑挂或
   分段跑时改从对应 rds 续跑。
7. **只跑部分阶段**：输入链 A → `seurat_raw.rds` → B → `seurat_filtered.rds` → C →
   `seurat_filtered_cc.rds` → D → `seurat_filtered_clustered.rds` → E；独立跑后半段时
   按各阶段代码块顶部的 `# 输入：` 注释补上对象读取。
8. **依赖包**：`Seurat`、`harmony`、`ggplot2`、`patchwork`、`dplyr`、`scales`、
   `presto`（AUC 筛 marker）；lisi 仅 Harmony 定量复核（可选）用。
9. **肘图定 dims**：读的是 `pca` 的标准差（harmony 只做矫正、不改变维数，所以 PCA 的拐点
   直接对应 `dims_use`）。本项目实测 PC1–5 陡降（每维 −0.5～−2.4）、**PC5–7 压平**，
   之后长尾缓降：PC20 累计方差 90.9%、PC25 95.9%——按“最陡拐点”截到 5–7 会丢稀有群，
   实务取 15–20（本项目 `1:15`）。想看累计方差曲线用
   `ElbowPlot(..., plot_type = "cumulative_variance")`（另有 `"variance"`，默认 `"stdev"`）。
10. **marker 双筛（AUC + pseudobulk）**：
    - `presto::wilcoxauc()` 的 Seurat 方法里那个叫 `assay` 的参数其实是 **layer**（默认
      `"data"`，即归一化后的数据），返回表的 `padj` 是簇内 BH 校正；给矩阵时用
      `wilcoxauc(pb_cpm, y = 簇标签)`。
    - 别用 `AggregateExpression()` 做 pseudobulk：它内部写死 `layer = "counts"`（再传
      `layer =` 会报“参数匹配到多个实参”），而且会把列名里的 `_` 换成 `-`，按列名反解
      供者/簇会错位；改用 `counts %*% Matrix::sparseMatrix(...)` 自己聚合，键名可控。
    - ⚠️ 单供者簇必须有闸门：本项目簇 13 / 20 有 99–100% 的细胞来自同一供者（该供者有
      5p/3p 两个文库），单细胞 AUC 高达 0.97–0.99，全靠 `min_donors` 拦住；`min_cells_pb`
      拦的是“某供者在该簇只有几个细胞”产生的噪声 pseudobulk。
    - pseudobulk 检验是“该簇 vs 其余”，**非配对**；要控供者配对可改配对检验或 edgeR / limma。
    - 复筛后仍 0 marker 的簇分两种：全基因组 AUC 都不到 0.7（与相邻簇分不开，考虑合并或
      调 resolution）／单供者簇（该标 `"Remove"`）。
11. **中文标签画不出来**：默认 `pdf()` 不能渲染 CJK（`conversion failure ... mbcsToSbcs`，
    汉字直接丢），中文注释标签要换 `cairo_pdf()`（本机实测可正常嵌 PingFang SC 字体）；
    纯英文标签用 `pdf()` 无碍。
12. **`DimPlot(label = TRUE)` 对重复标签每类只画一个**，位置取该类细胞的中位坐标——用
    lineage 这类粗标签（如 `Epithelial` 覆盖 10 个簇）时，标签可能落在簇群之间的空白处；
    要每簇一个标签就改按 `seurat_clusters` 着色。
13. **⚠️ 通用原则**：运行报错或结果不合理时，优先检查对应位置的 `⚠️` 标注；
    本流程每个阶段都可能需要按数据情况调整（阈值、参数、标签、绘图细节）。
14. **阶段 A 清环境**：`rm(list = ls()); gc()` 放在文件开头、任何参数定义之前，
    重新读入前序导出的对象，避免上次运行残留串扰（也因此不会误删参数）。

## 环境

- 本项目实测：R 4.5.3 + Seurat 5.5.1 + harmony 2.0.5 + ggplot2 4.0.3 + patchwork 1.3.2 + presto 1.1.0
- 规模参考：77,944 细胞 / 21 簇；阶段 E 全程约 1.6 分钟、峰值内存约 3.8 GB（16 GB 机器够用）
- 解释器：`/Volumes/Tiplus/miniconda3/envs/r_env_453/bin/Rscript`
  （系统默认 `Rscript` 是指向已卸载 R.framework 的坏软链接，不能用）
