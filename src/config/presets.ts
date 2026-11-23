export type ArchPresetName = 'nextjs' | 'nestjs' | 'react-vite' | 'express';

export const AVAILABLE_PRESETS: readonly ArchPresetName[] = [
  'nextjs',
  'nestjs',
  'react-vite',
  'express',
] as const;

const NEXTJS_PRESET_YAML = `version: "1.0"
project_type: "nextjs-clean-arch"

# 1. Quy định ranh giới giữa các tầng (Next.js App Router Clean Architecture)
layers:
  app:
    path: "src/app/**"
    cannot_import:
      - "src/db/**"
  ui:
    path: "src/components/**"
    cannot_import:
      - "src/db/**"
      - "src/services/backend/**"
  services:
    path: "src/services/**"
    cannot_import:
      - "src/components/**"
      - "src/app/**"
  db:
    path: "src/db/**"
    cannot_import:
      - "src/components/**"
      - "src/services/**"
      - "src/app/**"

# 2. Ngưỡng cảnh báo độ sạch code & phát hiện vòng lặp phụ thuộc
thresholds:
  max_file_lines: 300
  max_function_lines: 50
  detect_circular_dependencies: true

# 3. Danh sách thư viện được phép dùng
dependencies:
  allowed_ui:
    - "lucide-react"
    - "framer-motion"
    - "@radix-ui/*"
    - "clsx"
    - "tailwind-merge"
  allowed_validation:
    - "zod"
  allowed_core:
    - "react"
    - "react-dom"
    - "next"
    - "next/*"
  strict_mode: true

# 4. LLM Configuration (Tier 2 Alignment)
ai_eval:
  provider: "gemini"
  model: "gemini-2.5-flash"
  check_semantic_duplication: true
  check_prd_compliance: true
  prd_path: "PRD.md"
`;

const NESTJS_PRESET_YAML = `version: "1.0"
project_type: "nestjs-clean-arch"

# 1. Quy định ranh giới giữa các tầng (NestJS Modular / Clean Architecture)
layers:
  controllers:
    path: ["src/**/*.controller.ts", "src/controllers/**"]
    cannot_import:
      - "src/**/*.repository.ts"
      - "src/repositories/**"
      - "src/database/**"
      - "src/db/**"
  services:
    path: ["src/**/*.service.ts", "src/services/**", "src/use-cases/**"]
    cannot_import:
      - "src/**/*.controller.ts"
      - "src/controllers/**"
  domain:
    path: ["src/domain/**", "src/**/*.entity.ts"]
    cannot_import:
      - "src/**/*.controller.ts"
      - "src/**/*.service.ts"
      - "src/database/**"
      - "src/db/**"
  repositories:
    path: ["src/**/*.repository.ts", "src/repositories/**", "src/database/**", "src/db/**"]
    cannot_import:
      - "src/**/*.controller.ts"
      - "src/controllers/**"

thresholds:
  max_file_lines: 300
  max_function_lines: 55
  detect_circular_dependencies: true

dependencies:
  allowed_core:
    - "@nestjs/*"
    - "reflect-metadata"
    - "rxjs"
    - "rxjs/*"
  allowed_validation:
    - "class-validator"
    - "class-transformer"
    - "zod"
  strict_mode: true

ai_eval:
  provider: "gemini"
  model: "gemini-2.5-flash"
  check_semantic_duplication: true
  check_prd_compliance: true
  prd_path: "PRD.md"
`;

const REACT_VITE_PRESET_YAML = `version: "1.0"
project_type: "react-vite-clean-arch"

# 1. Quy định ranh giới giữa các tầng (React + Vite Feature Architecture)
layers:
  pages:
    path: "src/pages/**"
    cannot_import:
      - "src/api/internal/**"
  ui:
    path: "src/components/**"
    cannot_import:
      - "src/pages/**"
      - "src/api/**"
      - "src/services/**"
  hooks_and_state:
    path: ["src/hooks/**", "src/store/**"]
    cannot_import:
      - "src/pages/**"
      - "src/components/**"
  services:
    path: ["src/services/**", "src/api/**"]
    cannot_import:
      - "src/components/**"
      - "src/pages/**"
      - "src/hooks/**"

thresholds:
  max_file_lines: 280
  max_function_lines: 50
  detect_circular_dependencies: true

dependencies:
  allowed_core:
    - "react"
    - "react-dom"
    - "react-dom/*"
    - "react-router"
    - "react-router-dom"
  allowed_ui:
    - "lucide-react"
    - "@radix-ui/*"
    - "clsx"
    - "tailwind-merge"
  allowed_state:
    - "@tanstack/react-query"
    - "zustand"
    - "zod"
  strict_mode: true

ai_eval:
  provider: "gemini"
  model: "gemini-2.5-flash"
  check_semantic_duplication: true
  check_prd_compliance: true
  prd_path: "PRD.md"
`;

const EXPRESS_PRESET_YAML = `version: "1.0"
project_type: "express-layered-api"

# 1. Quy định ranh giới giữa các tầng (Express / Node.js Layered Backend)
layers:
  routes:
    path: "src/routes/**"
    cannot_import:
      - "src/repositories/**"
      - "src/db/**"
      - "src/models/**"
  controllers:
    path: "src/controllers/**"
    cannot_import:
      - "src/repositories/**"
      - "src/db/**"
      - "src/routes/**"
  services:
    path: "src/services/**"
    cannot_import:
      - "src/routes/**"
      - "src/controllers/**"
  db:
    path: ["src/repositories/**", "src/db/**", "src/models/**"]
    cannot_import:
      - "src/routes/**"
      - "src/controllers/**"
      - "src/services/**"

thresholds:
  max_file_lines: 300
  max_function_lines: 50
  detect_circular_dependencies: true

dependencies:
  allowed_server:
    - "express"
    - "cors"
    - "helmet"
    - "pino"
  allowed_validation:
    - "zod"
  strict_mode: true

ai_eval:
  provider: "gemini"
  model: "gemini-2.5-flash"
  check_semantic_duplication: true
  check_prd_compliance: true
  prd_path: "PRD.md"
`;

const PRESET_MAP: Record<ArchPresetName, string> = {
  nextjs: NEXTJS_PRESET_YAML,
  nestjs: NESTJS_PRESET_YAML,
  'react-vite': REACT_VITE_PRESET_YAML,
  express: EXPRESS_PRESET_YAML,
};

export function isValidPresetName(value: string): value is ArchPresetName {
  return Object.prototype.hasOwnProperty.call(PRESET_MAP, value);
}

export function getArchRulesPresetYaml(preset: ArchPresetName): string {
  return PRESET_MAP[preset];
}
