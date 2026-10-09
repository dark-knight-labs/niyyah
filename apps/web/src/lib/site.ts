/** Who runs this installation. Set at build time (NEXT_PUBLIC_*) so the legal pages name the right operator. */
export const site = {
  operator: process.env.NEXT_PUBLIC_OPERATOR_NAME || "the operator of this installation",
  contact: process.env.NEXT_PUBLIC_OPERATOR_CONTACT || "",
  url: process.env.NEXT_PUBLIC_SITE_URL || "",
};
