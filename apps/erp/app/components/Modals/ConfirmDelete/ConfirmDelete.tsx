import {
  Button,
  Modal,
  ModalBody,
  ModalContent,
  ModalFooter,
  ModalHeader,
  ModalTitle
} from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import { Form, useNavigation } from "react-router";

type ConfirmDeleteProps = {
  action?: string;
  isOpen?: boolean;
  name: string;
  text: string;
  deleteText?: string;
  onCancel: () => void;
  onSubmit?: () => void;
  disabled?: boolean;
};

const ConfirmDelete = ({
  action,
  isOpen = true,
  name,
  text,
  deleteText = "Delete",
  onCancel,
  onSubmit,
  disabled = false
}: ConfirmDeleteProps) => {
  const { t } = useLingui();
  const navigation = useNavigation();
  const isSubmitting = navigation.state !== "idle";

  return (
    <Modal
      open={isOpen}
      onOpenChange={(open) => {
        if (!open) onCancel();
      }}
    >
      <ModalContent>
        <ModalHeader>
          <ModalTitle>{t`Delete ${name}`}</ModalTitle>
        </ModalHeader>

        <ModalBody>
          <p className="text-sm text-muted-foreground">{text}</p>
        </ModalBody>

        <ModalFooter>
          <Button variant="secondary" onClick={onCancel}>
            <Trans>Cancel</Trans>
          </Button>
          <Form
            method="post"
            action={action}
            navigate
            onSubmit={() => onSubmit?.()}
          >
            <Button
              variant="destructive"
              isLoading={isSubmitting}
              isDisabled={disabled || isSubmitting}
              type="submit"
            >
              {deleteText}
            </Button>
          </Form>
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
};

export default ConfirmDelete;
