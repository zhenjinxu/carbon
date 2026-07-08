import type { ChangeEvent } from "react";
import { useRef } from "react";
import type { ButtonProps } from "./Button";
import { Button } from "./Button";

type FileProps = Omit<ButtonProps, "onChange"> & {
  accept?: string;
  multiple?: boolean;
  onChange: (e: ChangeEvent<HTMLInputElement>) => Promise<void> | void;
};

const File = ({
  accept,
  className,
  children,
  multiple = false,
  onChange,
  ...props
}: FileProps) => {
  const fileInputRef = useRef<HTMLInputElement>(null);

  return (
    <div className="flex w-auto">
      <input
        ref={fileInputRef}
        type="file"
        hidden
        multiple={multiple}
        accept={accept}
        onChange={async (e) => {
          await onChange(e);
          // Reset so selecting the same file again triggers onChange
          if (fileInputRef.current) {
            fileInputRef.current.value = "";
          }
        }}
      />
      <Button
        className={className}
        {...props}
        variant={props.variant ?? "secondary"}
        onClick={() => {
          if (fileInputRef.current) fileInputRef.current.click();
        }}
      >
        {children}
      </Button>
    </div>
  );
};

export { File };
