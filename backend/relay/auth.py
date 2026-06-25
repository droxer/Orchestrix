import sys

from .security import auth as _module

sys.modules[__name__] = _module
