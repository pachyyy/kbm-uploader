"use client";

import { useState } from "react";
import { CalendarIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { formatLongDate } from "@/lib/dates";
import { cn } from "@/lib/utils";

interface DatePickerProps {
  id?: string;
  value: Date | undefined;
  onChange: (date: Date | undefined) => void;
  /** Frozen while a draft run is in flight: the run is filed under one date. */
  disabled?: boolean;
}

export function DatePicker({ id, value, onChange, disabled: locked = false }: DatePickerProps) {
  const [open, setOpen] = useState(false);

  // KBM sessions only ever happen on Sunday, and a report can only describe a
  // class that has already taken place — so everything else is unselectable
  // rather than merely defaulted away from. `after` compares calendar days, so
  // today itself stays enabled.
  const disabled = [{ dayOfWeek: [1, 2, 3, 4, 5, 6] }, { after: new Date() }];

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        disabled={locked}
        render={
          <Button
            id={id}
            variant="outline"
            className={cn(
              "w-full justify-start font-normal",
              !value && "text-muted-foreground"
            )}
          />
        }
      >
        <CalendarIcon data-icon="inline-start" />
        {value ? formatLongDate(value) : "Pick a Sunday"}
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0" align="start">
        <Calendar
          mode="single"
          selected={value}
          onSelect={(date) => {
            onChange(date);
            setOpen(false);
          }}
          disabled={disabled}
          defaultMonth={value}
          autoFocus
        />
      </PopoverContent>
    </Popover>
  );
}
