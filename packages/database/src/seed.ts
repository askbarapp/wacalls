import argon2 from "argon2";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const email = process.env.ADMIN_EMAIL ?? "admin@localhost";
  const password = process.env.ADMIN_PASSWORD;
  const orgName = process.env.ADMIN_ORG_NAME ?? "WaCalls";

  if (!password) {
    console.log("ADMIN_PASSWORD not set; skipping seed.");
    return;
  }

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    console.log("Admin user already exists.");
    return;
  }

  const passwordHash = await argon2.hash(password, { type: argon2.argon2id });
  const slug = orgName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "wacalls";

  await prisma.$transaction(async (tx) => {
    const org = await tx.organization.create({
      data: { name: orgName, slug },
    });
    const user = await tx.user.create({
      data: {
        email,
        passwordHash,
        name: "Administrator",
        isSuperAdmin: true,
      },
    });
    await tx.organizationUser.create({
      data: {
        organizationId: org.id,
        userId: user.id,
        role: "ORG_ADMIN",
      },
    });
  });

  console.log(`Seeded admin ${email} for organization ${orgName}`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
