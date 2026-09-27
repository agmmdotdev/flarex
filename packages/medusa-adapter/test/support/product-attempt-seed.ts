/** Inputs for the existing native tag, category and Product-create paths.
 * The create result supplies generated option/value IDs for before/after
 * comparisons; fixed IDs make the other graph branches independently visible. */
export function productAttemptSeed(suffix: string, profile: "existing" | "launch" = "existing") {
  const productId = `prod_mixed_${suffix}`;
  const tagId = `ptag_mixed_${suffix}`;
  const categoryId = `pcat_mixed_${suffix}`;
  const variantId = `pvar_mixed_${suffix}`;
  const imageId = `img_mixed_${suffix}`;
  const newHandle = `mixed-published-${suffix}`;
  const newTitle = `Mixed published ${suffix}`;
  return {
    productId, tagId, categoryId, variantId, imageId, newHandle, newTitle,
    tagInput: { id: tagId, value: profile === "launch" ? "preview" : `Mixed tag ${suffix}` },
    categoryInput: { id: categoryId, name: `Mixed category ${suffix}` },
    createInput: { products: [{
      id: productId, title: `Mixed draft ${suffix}`,
      tag_ids: [tagId], category_ids: [categoryId],
      options: [{ title: "Size", values: profile === "launch" ? ["0"] : ["Small", "Large"] }],
      ...(profile === "launch" ? {} : { variants: [{ id: variantId, title: "Small variant", options: { Size: "Small" } }] }),
      images: [{ id: imageId, url: `https://example.invalid/${suffix}.png` }],
    }] },
    updateInput: { id: productId, data: { title: newTitle, handle: newHandle, status: "published" as const } },
    retrieveInput: { id: productId },
    listInput: { filters: { handle: newHandle } },
  };
}
