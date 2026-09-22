import { useLingui } from "@lingui/react/macro";
import { AiOutlinePartition } from "react-icons/ai";
import {
  LuArchive,
  LuAtom,
  LuAxis3D,
  LuBeef,
  LuDessert,
  LuGlassWater,
  LuGroup,
  LuHammer,
  LuLayoutDashboard,
  LuPizza,
  LuPuzzle,
  LuRuler,
  LuShapes
} from "react-icons/lu";
import { usePermissions } from "~/hooks";
import { useSavedViews } from "~/hooks/useSavedViews";
import type { AuthenticatedRouteGroup } from "~/types";
import { path } from "~/utils/path";

export default function useItemsSubmodules() {
  const { t } = useLingui();
  const permissions = usePermissions();
  const { addSavedViewsToRoutes } = useSavedViews();
  const itemsRoutes: AuthenticatedRouteGroup[] = [
    {
      name: t`Manage`,
      routes: [
        {
          name: t`Parts`,
          to: path.to.parts,
          icon: <AiOutlinePartition />,
          table: "part"
        },
        {
          name: t`Materials`,
          to: path.to.materials,
          icon: <LuAtom />,
          table: "material"
        },
        {
          name: t`Tools`,
          to: path.to.tools,
          icon: <LuHammer />,
          table: "tool"
        },
        {
          name: t`Consumables`,
          to: path.to.consumables,
          icon: <LuPizza />,
          table: "consumable"
        }
      ]
    },
    {
      name: t`Material Properties`,
      routes: [
        {
          name: t`Dimensions`,
          to: path.to.materialDimensions,
          icon: <LuAxis3D />,
          role: "employee"
        },
        {
          name: t`Finishes`,
          to: path.to.materialFinishes,
          icon: <LuDessert />,
          role: "employee"
        },
        {
          name: t`Grades`,
          to: path.to.materialGrades,
          icon: <LuBeef />,
          role: "employee"
        },
        {
          name: t`Shapes`,
          to: path.to.materialForms,
          icon: <LuShapes />,
          role: "employee"
        },
        {
          name: t`Substances`,
          to: path.to.materialSubstances,
          icon: <LuGlassWater />,
          role: "employee"
        },
        {
          name: t`Types`,
          to: path.to.materialTypes,
          icon: <LuPuzzle />,
          role: "employee"
        }
      ]
    },
    {
      name: t`Configure`,
      routes: [
        {
          name: t`Item Groups`,
          to: path.to.itemPostingGroups,
          role: "employee",
          icon: <LuGroup />
        },
        {
          name: t`Units`,
          to: path.to.uoms,
          role: "employee",
          icon: <LuRuler />
        }
      ]
    },
    {
      name: "归档",
      routes: [
        {
          name: "归档记录",
          to: path.to.itemDeletionArchive,
          role: "employee",
          permission: "settings",
          icon: <LuArchive />
        }
      ]
    },

    {
      name: t`个人工作台`,
      routes: [
        {
          name: t`我的工作台`,
          to: path.to.itemsWorkbench,
          role: "employee",
          icon: <LuLayoutDashboard />
        }
      ]
    }
  ];

  const isRouteVisible = (route: AuthenticatedRouteGroup["routes"][number]) => {
    if (route.role && !permissions.is(route.role)) return false;
    if (route.permission && !permissions.can("view", route.permission)) {
      return false;
    }
    return true;
  };

  return {
    groups: itemsRoutes
      .filter((group) => group.routes.filter(isRouteVisible).length > 0)
      .map((group) => ({
        ...group,
        routes: group.routes.filter(isRouteVisible).map(addSavedViewsToRoutes)
      }))
  };
}
