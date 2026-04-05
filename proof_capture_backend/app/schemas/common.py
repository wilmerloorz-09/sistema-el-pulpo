from typing import Generic, TypeVar

from pydantic import BaseModel

DataT = TypeVar("DataT")


class ApiResponse(BaseModel, Generic[DataT]):
  success: bool = True
  message: str
  data: DataT | None = None
  error_code: str | None = None
