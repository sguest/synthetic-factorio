-- Space-age uses globals defined in the base mod
-- for example "apply_heat_pipe_glow" is defined in base.prototypes.entity.entities, but then used in space-age.prototypes.entity.entities without being re-declared
-- Therefore both mods need to load in the same lua context to preserve globals
-- However, both mods use the same import paths to refer to their own files, for example both mods import "prototypes.tile.tiles" but refer to different files
-- The lua spec says such an import re-uses the existing module, even if package.paths has changed
-- Therefore, clear imports between mod loads

for k, v in pairs(package.loaded) do
    if(string.find(k, 'prototypes')) then
        package.loaded[k] = false
    end
end
