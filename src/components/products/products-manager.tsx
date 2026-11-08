"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import {
  ImageIcon,
  ImagePlus,
  Loader2,
  Package,
  Pencil,
  Plus,
  Search,
  Trash2,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useAuth } from "@/hooks/use-auth";
import { canEditSettings } from "@/lib/auth/roles";
import { cn } from "@/lib/utils";
import { deleteAccountMedia, uploadAccountMedia } from "@/lib/storage/upload-media";
import {
  PRODUCT_PHOTO_ACCEPT,
  shrinkProductPhoto,
} from "@/lib/products/resize-image";
import { PRODUCT_IMAGES_BUCKET, type ProductWithImage } from "@/lib/products/types";

interface Draft {
  id?: string;
  category: string;
  name: string;
  price: string;
  currency: string;
  sizes: string;
  colors: string;
  in_stock: boolean;
  stock_note: string;
  description: string;
  is_active: boolean;
  image_path: string | null;
  image_url: string | null;
  /** Photo path saved on the product when the dialog opened. Photos
   *  uploaded during this edit but never saved are deleted on cancel. */
  original_image_path: string | null;
}

function emptyDraft(category = ""): Draft {
  return {
    category,
    name: "",
    price: "",
    currency: "AFN",
    sizes: "",
    colors: "",
    in_stock: true,
    stock_note: "",
    description: "",
    is_active: true,
    image_path: null,
    image_url: null,
    original_image_path: null,
  };
}

function draftFrom(p: ProductWithImage): Draft {
  return {
    id: p.id,
    category: p.category,
    name: p.name,
    price: String(p.price),
    currency: p.currency,
    sizes: p.sizes.join(", "),
    colors: p.colors.join(", "),
    in_stock: p.in_stock,
    stock_note: p.stock_note ?? "",
    description: p.description ?? "",
    is_active: p.is_active,
    image_path: p.image_path,
    image_url: p.image_url,
    original_image_path: p.image_path,
  };
}

/** Delete a photo uploaded in this dialog that won't be kept. */
function discardUnsavedPhoto(path: string | null, original: string | null) {
  if (path && path !== original) {
    void deleteAccountMedia(PRODUCT_IMAGES_BUCKET, path).catch(() => undefined);
  }
}

function formatAmount(price: number): string {
  return Number.isInteger(price)
    ? price.toLocaleString("en-US")
    : price.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function ProductsManager() {
  const t = useTranslations("Products");
  const { accountRole } = useAuth();
  const canEdit = accountRole ? canEditSettings(accountRole) : false;

  const [products, setProducts] = useState<ProductWithImage[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [activeCategory, setActiveCategory] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/products", { cache: "no-store" });
      const data = await res.json().catch(() => ({}));
      if (res.ok) setProducts((data.products as ProductWithImage[]) ?? []);
      else toast.error(data.error ?? t("loadError"));
    } catch {
      toast.error(t("loadError"));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    void load();
  }, [load]);

  const categories = useMemo(
    () => Array.from(new Set(products.map((p) => p.category))).sort((a, b) => a.localeCompare(b)),
    [products],
  );

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return products.filter((p) => {
      if (activeCategory && p.category !== activeCategory) return false;
      if (!q) return true;
      return (
        p.name.toLowerCase().includes(q) ||
        p.category.toLowerCase().includes(q) ||
        (p.description ?? "").toLowerCase().includes(q)
      );
    });
  }, [products, query, activeCategory]);

  const grouped = useMemo(() => {
    const map = new Map<string, ProductWithImage[]>();
    for (const p of visible) {
      const list = map.get(p.category) ?? [];
      list.push(p);
      map.set(p.category, list);
    }
    return Array.from(map.entries()).sort(([a], [b]) => a.localeCompare(b));
  }, [visible]);

  const withoutPhoto = products.filter((p) => p.is_active && !p.image_path).length;

  const pickPhoto = async (file: File | undefined) => {
    if (!file || !draft) return;
    setUploading(true);
    try {
      const small = await shrinkProductPhoto(file);
      const { path, publicUrl } = await uploadAccountMedia(PRODUCT_IMAGES_BUCKET, small);
      setDraft((d) => {
        if (!d) return d;
        discardUnsavedPhoto(d.image_path, d.original_image_path);
        return { ...d, image_path: path, image_url: publicUrl };
      });
    } catch (err) {
      const code = err instanceof Error ? err.message : "";
      toast.error(
        code === "unsupported"
          ? t("photoUnsupported")
          : code === "too_large"
            ? t("photoTooLarge")
            : t("photoUploadError"),
      );
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const closeDraft = () => {
    if (draft) discardUnsavedPhoto(draft.image_path, draft.original_image_path);
    setDraft(null);
  };

  const save = async () => {
    if (!draft) return;
    if (!draft.category.trim()) return toast.error(t("categoryRequired"));
    if (!draft.name.trim()) return toast.error(t("nameRequired"));
    if (!draft.price.trim()) return toast.error(t("priceRequired"));
    setSaving(true);
    try {
      const payload = {
        category: draft.category,
        name: draft.name,
        price: draft.price,
        currency: draft.currency,
        sizes: draft.sizes,
        colors: draft.colors,
        in_stock: draft.in_stock,
        stock_note: draft.stock_note,
        description: draft.description,
        is_active: draft.is_active,
        image_path: draft.image_path,
      };
      const res = await fetch(draft.id ? `/api/products/${draft.id}` : "/api/products", {
        method: draft.id ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data.error ?? t("saveError"));
        return;
      }
      toast.success(draft.id ? t("updated") : t("created"));
      setDraft(null);
      await load();
    } catch {
      toast.error(t("saveError"));
    } finally {
      setSaving(false);
    }
  };

  const remove = async (p: ProductWithImage) => {
    if (!window.confirm(t("deleteConfirm", { name: p.name }))) return;
    const res = await fetch(`/api/products/${p.id}`, { method: "DELETE" });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      toast.error(data.error ?? t("deleteError"));
      return;
    }
    toast.success(t("deleted"));
    await load();
  };

  const toggleStock = async (p: ProductWithImage) => {
    const next = !p.in_stock;
    setProducts((list) => list.map((x) => (x.id === p.id ? { ...x, in_stock: next } : x)));
    const res = await fetch(`/api/products/${p.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ in_stock: next }),
    });
    if (!res.ok) {
      setProducts((list) => list.map((x) => (x.id === p.id ? { ...x, in_stock: !next } : x)));
      toast.error(t("saveError"));
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">{t("title")}</h1>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">{t("description")}</p>
        </div>
        {canEdit && (
          <Button onClick={() => setDraft(emptyDraft(activeCategory ?? ""))} className="self-start sm:self-auto">
            <Plus className="me-1.5 h-4 w-4" />
            {t("add")}
          </Button>
        )}
      </div>

      {products.length > 0 && (
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <div className="relative w-full sm:max-w-xs">
            <Search className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t("searchPlaceholder")}
              className="ps-9"
            />
          </div>
          <div className="flex flex-wrap gap-1.5">
            <CategoryChip
              label={t("allCategories", { count: products.length })}
              active={activeCategory === null}
              onClick={() => setActiveCategory(null)}
            />
            {categories.map((c) => (
              <CategoryChip
                key={c}
                label={`${c} · ${products.filter((p) => p.category === c).length}`}
                active={activeCategory === c}
                onClick={() => setActiveCategory(c)}
              />
            ))}
          </div>
        </div>
      )}

      {withoutPhoto > 0 && canEdit && (
        <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-700 dark:text-amber-300">
          {t("missingPhotos", { count: withoutPhoto })}
        </div>
      )}

      {loading ? (
        <div className="flex justify-center py-16">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      ) : products.length === 0 ? (
        <div className="flex flex-col items-center rounded-2xl border border-dashed border-border px-6 py-16 text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 text-primary">
            <Package className="h-6 w-6" />
          </div>
          <p className="mt-4 text-base font-medium text-foreground">{t("emptyTitle")}</p>
          <p className="mt-1 max-w-md text-sm text-muted-foreground">{t("emptyBody")}</p>
          {canEdit && (
            <Button className="mt-5" onClick={() => setDraft(emptyDraft())}>
              <Plus className="me-1.5 h-4 w-4" />
              {t("addFirst")}
            </Button>
          )}
        </div>
      ) : visible.length === 0 ? (
        <p className="py-12 text-center text-sm text-muted-foreground">{t("noResults")}</p>
      ) : (
        <div className="space-y-8">
          {grouped.map(([category, list]) => (
            <section key={category}>
              <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                {category}
              </h2>
              <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 lg:grid-cols-4 2xl:grid-cols-5">
                {list.map((p) => (
                  <li
                    key={p.id}
                    className={cn(
                      "group flex flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-soft transition-shadow hover:shadow-lift",
                      !p.is_active && "opacity-60",
                    )}
                  >
                    <div className="relative aspect-[4/3] bg-muted">
                      {p.image_url ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={p.image_url}
                          alt={p.name}
                          loading="lazy"
                          className="h-full w-full object-cover"
                        />
                      ) : (
                        <div className="flex h-full w-full flex-col items-center justify-center gap-2 text-muted-foreground">
                          <ImageIcon className="h-8 w-8" />
                          <span className="text-xs">{t("noPhoto")}</span>
                        </div>
                      )}
                      {!p.is_active && (
                        <span className="absolute start-2 top-2 rounded-md bg-background/90 px-2 py-0.5 text-xs font-medium text-foreground">
                          {t("hidden")}
                        </span>
                      )}
                    </div>
                    <div className="flex flex-1 flex-col gap-1.5 p-3 sm:p-4">
                      <p className="line-clamp-2 text-sm font-medium leading-snug text-foreground">{p.name}</p>
                      <p className="text-base font-semibold text-foreground">
                        <bdi dir="ltr">
                          {formatAmount(p.price)}{" "}
                          <span className="text-xs font-normal text-muted-foreground">{p.currency}</span>
                        </bdi>
                      </p>
                      {(p.sizes.length > 0 || p.colors.length > 0) && (
                        <p className="line-clamp-2 text-xs text-muted-foreground">
                          {[p.sizes.join(" · "), p.colors.join(" · ")].filter(Boolean).join("  —  ")}
                        </p>
                      )}
                      <div className="mt-auto flex items-center justify-between pt-2">
                        <button
                          type="button"
                          disabled={!canEdit}
                          onClick={() => toggleStock(p)}
                          className={cn(
                            "rounded-full px-2.5 py-1 text-xs font-medium transition-colors disabled:cursor-default",
                            p.in_stock
                              ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
                              : "bg-red-500/10 text-red-700 dark:text-red-300",
                          )}
                          title={canEdit ? t("toggleStockHint") : undefined}
                        >
                          {p.in_stock ? t("inStock") : t("outOfStock")}
                        </button>
                        {canEdit && (
                          <div className="flex gap-1">
                            <Button variant="ghost" size="icon-sm" aria-label={t("edit")} onClick={() => setDraft(draftFrom(p))}>
                              <Pencil className="h-4 w-4" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon-sm"
                              aria-label={t("delete")}
                              onClick={() => remove(p)}
                              className="text-red-500 hover:bg-red-500/10 hover:text-red-600"
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </div>
                        )}
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}

      <Dialog open={!!draft} onOpenChange={(o) => !o && !saving && closeDraft()}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>{draft?.id ? t("editTitle") : t("addTitle")}</DialogTitle>
          </DialogHeader>
          {draft && (
            <div className="grid max-h-[70vh] gap-5 overflow-y-auto pe-1 sm:grid-cols-[200px_1fr]">
              <div>
                <FieldLabel>{t("photoLabel")}</FieldLabel>
                <button
                  type="button"
                  onClick={() => fileRef.current?.click()}
                  disabled={uploading}
                  className="relative flex aspect-square w-full items-center justify-center overflow-hidden rounded-xl border border-dashed border-border bg-muted text-muted-foreground transition-colors hover:border-primary hover:text-primary"
                >
                  {uploading ? (
                    <Loader2 className="h-6 w-6 animate-spin" />
                  ) : draft.image_url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={draft.image_url} alt="" className="h-full w-full object-cover" />
                  ) : (
                    <span className="flex flex-col items-center gap-2 px-3 text-center text-xs">
                      <ImagePlus className="h-7 w-7" />
                      {t("photoAdd")}
                    </span>
                  )}
                </button>
                <input
                  ref={fileRef}
                  type="file"
                  accept={PRODUCT_PHOTO_ACCEPT}
                  className="hidden"
                  onChange={(e) => void pickPhoto(e.target.files?.[0])}
                />
                <p className="mt-2 text-xs text-muted-foreground">{t("photoHint")}</p>
                {draft.image_url && !uploading && (
                  <button
                    type="button"
                    onClick={() => {
                      discardUnsavedPhoto(draft.image_path, draft.original_image_path);
                      setDraft({ ...draft, image_path: null, image_url: null });
                    }}
                    className="mt-1 text-xs text-red-500 hover:underline"
                  >
                    {t("photoRemove")}
                  </button>
                )}
              </div>

              <div className="space-y-4">
                <div className="grid gap-4 sm:grid-cols-2">
                  <div>
                    <FieldLabel>{t("categoryLabel")}</FieldLabel>
                    <Input
                      value={draft.category}
                      onChange={(e) => setDraft({ ...draft, category: e.target.value })}
                      placeholder={t("categoryPlaceholder")}
                      list="product-categories"
                      maxLength={60}
                    />
                    <datalist id="product-categories">
                      {categories.map((c) => (
                        <option key={c} value={c} />
                      ))}
                    </datalist>
                  </div>
                  <div>
                    <FieldLabel>{t("nameLabel")}</FieldLabel>
                    <Input
                      value={draft.name}
                      onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                      placeholder={t("namePlaceholder")}
                      maxLength={120}
                    />
                  </div>
                </div>

                <div className="grid grid-cols-[1fr_96px] gap-3">
                  <div>
                    <FieldLabel>{t("priceLabel")}</FieldLabel>
                    <Input
                      value={draft.price}
                      onChange={(e) => setDraft({ ...draft, price: e.target.value })}
                      inputMode="decimal"
                      placeholder="1200"
                      dir="ltr"
                    />
                  </div>
                  <div>
                    <FieldLabel>{t("currencyLabel")}</FieldLabel>
                    <Input
                      value={draft.currency}
                      onChange={(e) => setDraft({ ...draft, currency: e.target.value.toUpperCase() })}
                      maxLength={8}
                      dir="ltr"
                    />
                  </div>
                </div>

                <div className="grid gap-4 sm:grid-cols-2">
                  <div>
                    <FieldLabel>{t("sizesLabel")}</FieldLabel>
                    <Input
                      value={draft.sizes}
                      onChange={(e) => setDraft({ ...draft, sizes: e.target.value })}
                      placeholder={t("sizesPlaceholder")}
                    />
                  </div>
                  <div>
                    <FieldLabel>{t("colorsLabel")}</FieldLabel>
                    <Input
                      value={draft.colors}
                      onChange={(e) => setDraft({ ...draft, colors: e.target.value })}
                      placeholder={t("colorsPlaceholder")}
                    />
                  </div>
                </div>
                <p className="-mt-2 text-xs text-muted-foreground">{t("listHint")}</p>

                <div className="flex items-center justify-between rounded-lg border border-border px-3 py-2.5">
                  <div>
                    <p className="text-sm font-medium text-foreground">{t("inStockLabel")}</p>
                    <p className="text-xs text-muted-foreground">{t("inStockHint")}</p>
                  </div>
                  <Switch
                    checked={draft.in_stock}
                    onCheckedChange={(v) => setDraft({ ...draft, in_stock: v })}
                  />
                </div>

                <div>
                  <FieldLabel>{t("stockNoteLabel")}</FieldLabel>
                  <Input
                    value={draft.stock_note}
                    onChange={(e) => setDraft({ ...draft, stock_note: e.target.value })}
                    placeholder={t("stockNotePlaceholder")}
                    maxLength={200}
                  />
                </div>

                <div>
                  <FieldLabel>{t("descriptionLabel")}</FieldLabel>
                  <Textarea
                    value={draft.description}
                    onChange={(e) => setDraft({ ...draft, description: e.target.value })}
                    placeholder={t("descriptionPlaceholder")}
                    maxLength={1000}
                    className="min-h-20"
                  />
                </div>

                <div className="flex items-center justify-between rounded-lg border border-border px-3 py-2.5">
                  <div>
                    <p className="text-sm font-medium text-foreground">{t("activeLabel")}</p>
                    <p className="text-xs text-muted-foreground">{t("activeHint")}</p>
                  </div>
                  <Switch
                    checked={draft.is_active}
                    onCheckedChange={(v) => setDraft({ ...draft, is_active: v })}
                  />
                </div>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={closeDraft} disabled={saving}>
              {t("cancel")}
            </Button>
            <Button onClick={save} disabled={saving || uploading}>
              {saving && <Loader2 className="me-1.5 h-4 w-4 animate-spin" />}
              {t("save")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function FieldLabel({ children }: { children: React.ReactNode }) {
  return <label className="mb-1.5 block text-xs font-medium text-muted-foreground">{children}</label>;
}

function CategoryChip({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "rounded-full border px-3 py-1 text-xs font-medium transition-colors",
        active
          ? "border-primary bg-primary text-primary-foreground"
          : "border-border bg-card text-muted-foreground hover:text-foreground",
      )}
    >
      {label}
    </button>
  );
}
