import { useForm } from "react-hook-form";
import { X, Loader2 } from "lucide-react";
import { cn } from "@/lib/cn";
import type { EntitySpec, FieldSpec } from "@/types/spec";
import { getFormFields } from "@/lib/spec";

interface DynamicFormProps {
  entity: EntitySpec;
  mode: "create" | "edit";
  defaultValues?: Record<string, unknown>;
  onSubmit: (data: Record<string, unknown>) => void;
  onClose: () => void;
  isLoading?: boolean;
}

function FieldInput({
  field,
  register,
  errors,
  requiredFields,
}: {
  field: FieldSpec;
  register: ReturnType<typeof useForm>["register"];
  errors: Record<string, { message?: string }>;
  requiredFields: string[];
}) {
  const isRequired = requiredFields.includes(field.name) || field.validation?.required;
  const label = field.name.replace(/_/g, " ");

  // Select for enums
  if (field.enum_values && field.enum_values.length > 0) {
    return (
      <div>
        <label className="mb-1 block text-xs font-medium uppercase tracking-wider text-slate-400">
          {label} {isRequired && <span className="text-red-400">*</span>}
        </label>
        <select
          {...register(field.name, { required: isRequired ? "Required" : false })}
          className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-slate-300 focus:border-blue-600 focus:outline-none"
        >
          {field.enum_values.map((val) => (
            <option key={val} value={val}>
              {val.replace(/_/g, " ")}
            </option>
          ))}
        </select>
        {errors[field.name] && (
          <p className="mt-1 text-xs text-red-400">{errors[field.name].message}</p>
        )}
      </div>
    );
  }

  // Boolean toggle
  if (field.db_type.startsWith("BOOLEAN")) {
    return (
      <div className="flex items-center gap-3">
        <input
          type="checkbox"
          {...register(field.name)}
          className="h-4 w-4 rounded border-slate-600 bg-slate-800 text-blue-600"
        />
        <label className="text-sm text-slate-300 capitalize">{label}</label>
      </div>
    );
  }

  // Number
  if (
    field.db_type.includes("NUMERIC") ||
    field.db_type.includes("SMALLINT") ||
    field.db_type.includes("INTEGER")
  ) {
    return (
      <div>
        <label className="mb-1 block text-xs font-medium uppercase tracking-wider text-slate-400">
          {label} {isRequired && <span className="text-red-400">*</span>}
        </label>
        <input
          type="number"
          step={field.db_type.includes("NUMERIC") ? "0.01" : "1"}
          {...register(field.name, {
            required: isRequired ? "Required" : false,
            valueAsNumber: true,
            min: field.validation?.min != null ? { value: field.validation.min, message: `Min ${field.validation.min}` } : undefined,
            max: field.validation?.max != null ? { value: field.validation.max, message: `Max ${field.validation.max}` } : undefined,
          })}
          className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-slate-300 focus:border-blue-600 focus:outline-none"
        />
        {errors[field.name] && (
          <p className="mt-1 text-xs text-red-400">{errors[field.name].message}</p>
        )}
      </div>
    );
  }

  // Textarea for TEXT / Markdown
  if (field.db_type === "TEXT" && field.input_component === "MarkdownEditor") {
    return (
      <div>
        <label className="mb-1 block text-xs font-medium uppercase tracking-wider text-slate-400">
          {label}
        </label>
        <textarea
          {...register(field.name)}
          rows={4}
          className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-slate-300 focus:border-blue-600 focus:outline-none"
        />
      </div>
    );
  }

  // Date
  if (field.db_type.includes("TIMESTAMPTZ") || field.db_type === "DATE") {
    return (
      <div>
        <label className="mb-1 block text-xs font-medium uppercase tracking-wider text-slate-400">
          {label}
        </label>
        <input
          type={field.db_type === "DATE" ? "date" : "datetime-local"}
          {...register(field.name, { required: isRequired ? "Required" : false })}
          className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-slate-300 focus:border-blue-600 focus:outline-none"
        />
        {errors[field.name] && (
          <p className="mt-1 text-xs text-red-400">{errors[field.name].message}</p>
        )}
      </div>
    );
  }

  // Email
  if (field.input_component === "EmailInput" || field.validation?.format === "email") {
    return (
      <div>
        <label className="mb-1 block text-xs font-medium uppercase tracking-wider text-slate-400">
          {label}
        </label>
        <input
          type="email"
          {...register(field.name, {
            required: isRequired ? "Required" : false,
            pattern: { value: /^[^\s@]+@[^\s@]+\.[^\s@]+$/, message: "Invalid email" },
          })}
          className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-slate-300 focus:border-blue-600 focus:outline-none"
        />
        {errors[field.name] && (
          <p className="mt-1 text-xs text-red-400">{errors[field.name].message}</p>
        )}
      </div>
    );
  }

  // Default text input
  return (
    <div>
      <label className="mb-1 block text-xs font-medium uppercase tracking-wider text-slate-400">
        {label} {isRequired && <span className="text-red-400">*</span>}
      </label>
      <input
        type={field.input_component === "TelInput" ? "tel" : "text"}
        {...register(field.name, {
          required: isRequired ? "Required" : false,
          maxLength: field.validation?.max_length
            ? { value: field.validation.max_length, message: `Max ${field.validation.max_length} chars` }
            : undefined,
        })}
        className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-slate-300 focus:border-blue-600 focus:outline-none"
      />
      {errors[field.name] && (
        <p className="mt-1 text-xs text-red-400">{errors[field.name].message}</p>
      )}
    </div>
  );
}

export function DynamicForm({
  entity,
  mode,
  defaultValues,
  onSubmit,
  onClose,
  isLoading,
}: DynamicFormProps) {
  const formConfig = mode === "create" ? entity.ui_config.create_form : entity.ui_config.edit_form;
  const fields = getFormFields(entity, mode);
  const requiredFields = formConfig?.required_fields ?? [];

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm({
    defaultValues: (defaultValues ?? {}) as Record<string, unknown>,
  });

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />

      {/* Panel */}
      <div className="relative w-full max-w-lg rounded-l-2xl bg-slate-900 shadow-xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-700 px-6 py-4">
          <h2 className="text-lg font-semibold text-white">
            {formConfig?.title ?? `${mode === "create" ? "New" : "Edit"} ${entity.name}`}
          </h2>
          <button
            onClick={onClose}
            className="rounded-md p-1 text-slate-400 hover:bg-slate-800 hover:text-white"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Form body */}
        <form onSubmit={handleSubmit((data) => onSubmit(data))} className="flex flex-col h-[calc(100vh-73px)]">
          <div className="flex-1 space-y-4 overflow-y-auto p-6">
            {fields.map((field) => (
              <FieldInput
                key={field.name}
                field={field}
                register={register}
                errors={errors as Record<string, { message?: string }>}
                requiredFields={requiredFields}
              />
            ))}
          </div>

          {/* Footer */}
          <div className="flex items-center justify-end gap-3 border-t border-slate-700 px-6 py-4">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-slate-600 px-4 py-2 text-sm text-slate-300 hover:bg-slate-800"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isLoading}
              className={cn(
                "flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700",
                isLoading && "cursor-not-allowed opacity-75"
              )}
            >
              {isLoading && <Loader2 className="h-4 w-4 animate-spin" />}
              {mode === "create" ? "Create" : "Save Changes"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
