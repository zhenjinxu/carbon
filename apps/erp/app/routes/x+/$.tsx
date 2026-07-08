import { Link } from "react-router";
import { Button, Heading } from "@carbon/react";
import { Trans } from "@lingui/react/macro";

export default function NotFoundRoute() {
  return (
    <div className="light">
      <div className="flex flex-col w-full h-screen items-center justify-center space-y-4">
        <img
          src="/carbon-mark-light.svg"
          alt="Carbon Logo"
          className="block max-w-[60px] dark:hidden"
        />
        <img
          src="/carbon-mark-dark.svg"
          alt="Carbon Logo"
          className="max-w-[60px] hidden dark:block"
        />
        <Heading size="h1">
          <Trans>Page Not Found</Trans>
        </Heading>
        <p className="text-muted-foreground max-w-2xl">
          <Trans>The page you're looking for doesn't exist.</Trans>
        </p>
        <Button asChild>
          <Link to="/">
            <Trans>Back Home</Trans>
          </Link>
        </Button>
      </div>
    </div>
  );
}
